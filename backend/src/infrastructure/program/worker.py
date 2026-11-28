"""Single-station MPEG-TS worker. The Node supervisor owns stdin."""
import json
import base64
import sys
import struct
import math
from pathlib import Path
from collections import deque
from types import SimpleNamespace
import threading
import time

import gi
gi.require_version("Gst", "1.0")
gi.require_version("GdkPixbuf", "2.0")
from gi.repository import GLib, Gst, GdkPixbuf

Gst.init(None)
in_port, out_port = map(int, sys.argv[1:3])
slate = {"black": "black", "bars": "smpte100", "blue": "blue"}[sys.argv[3]]
input_host = sys.argv[4] if len(sys.argv) > 4 else "127.0.0.1"
initial = json.loads(sys.stdin.readline())
input_url = initial.get("inputUrl")
second_port = initial.get('secondPort')
auto_backup = initial.get("autoBackup", False)
black_seconds = initial.get("blackSeconds", 0)
freeze_seconds = initial.get("freezeSeconds", 0)
silence_seconds = initial.get("silenceSeconds", 0)
program_audio = None
reported_program_audio = None
program_gain_db = 0
next_meter_update = 0
recording_path = initial.get("recordingPath")
hls_path = Path(initial["hlsPath"]) if initial.get("hlsPath") else None
hls = SimpleNamespace(graph=None, state="starting")
hls_stop = threading.Event()
hls_started = threading.Event()
audio_monitor = initial.get("audioMonitor", True) and Gst.ElementFactory.find("lamemp3enc") is not None
srt_destinations = [
    SimpleNamespace(id=config["id"], url=config["url"], state="connecting",
                    graph=None, retry=0, sent_bytes=0, progress=0)
    for config in initial.get("srtDestinations", [])
]
srt_stop = threading.Event()
recording_state = "starting" if recording_path else "disabled"
recording_stop = threading.Event()
width, height = initial["canvas"]["width"], initial["canvas"]["height"]
video = f"video/x-raw,format=I420,width={width},height={height},framerate=25/1,pixel-aspect-ratio=1/1"
audio = "audio/x-raw,format=S16LE,layout=interleaved,rate=48000,channels=2"
input_audio_queue_buffers = 4  # Short queue to limit the delay behind the synchronized input video.
pipeline = Gst.parse_launch(
    f"videotestsrc is-live=true pattern={slate} ! {video} ! v.sink_0 "
    f"intervideosrc channel=obs ! {video} ! v.sink_1 "
    + (f"intervideosrc channel=obs2 ! {video} ! v.sink_2 " if second_port else "")
    +
    "input-selector name=v ! gdkpixbufoverlay name=scenevideo alpha=0 ! "
    "gdkpixbufoverlay name=sceneimage alpha=0 positioning-mode=pixels-absolute ! "
    "gdkpixbufoverlay name=scene_fade alpha=0 ! tee name=picture "
    "picture. ! queue leaky=downstream max-size-buffers=1 ! videorate drop-only=true ! videoscale ! "
    "video/x-raw,width=320,height=180,framerate=1/1 ! jpegenc ! appsink name=preview max-buffers=1 drop=true sync=false async=false "
    "picture. ! queue ! "
    + "".join(f"gdkpixbufoverlay name=ad{i} alpha=0 positioning-mode=pixels-absolute ! " for i in range(4))
    + "gdkpixbufoverlay name=watermark ! gdkpixbufoverlay name=ticker positioning-mode=pixels-absolute alpha=0 ! tee name=composed "
    "composed. ! queue leaky=downstream max-size-buffers=1 ! videorate drop-only=true ! videoscale ! "
    "video/x-raw,width=320,height=180,framerate=2/1 ! jpegenc ! "
    "appsink name=program_monitor max-buffers=1 drop=true sync=false async=false "
    "composed. ! queue ! x264enc tune=zerolatency speed-preset=veryfast "
    "bitrate=2500 key-int-max=25 bframes=0 ! h264parse config-interval=-1 ! tee name=encoded_video ! queue ! mux. "
    f"appsrc name=local_audio is-live=true format=time max-bytes=7680 caps=\"{audio}\" ! clocksync ! "
    f"volume name=program_volume ! {audio} ! tee name=program_sound "
    "program_sound. ! "
    "audioconvert name=program_meter ! avenc_aac ! aacparse ! tee name=encoded_audio ! queue ! mux. "
    "mpegtsmux name=mux alignment=7 ! tee name=delivery "
    f"delivery. ! queue ! udpsink name=output host=127.0.0.1 port={out_port} sync=false async=false "
    + ("delivery. ! queue leaky=downstream max-size-buffers=64 max-size-time=0 max-size-bytes=0 ! "
       "appsink name=recording max-buffers=64 drop=true sync=false async=false " if recording_path else "")
    + "".join(
        "delivery. ! queue leaky=downstream max-size-buffers=32 ! "
        f"appsink name=srt_{destination.id} max-buffers=32 drop=true sync=false async=false "
        for destination in srt_destinations
    )
    + ("encoded_video. ! queue leaky=downstream max-size-buffers=64 ! "
       "appsink name=hls_video max-buffers=64 drop=true sync=false async=false "
       "encoded_audio. ! queue leaky=downstream max-size-buffers=128 ! "
       "appsink name=hls_audio max-buffers=128 drop=true sync=false async=false " if hls_path else "")
    + ("program_sound. ! queue leaky=downstream max-size-buffers=12 ! valve name=audio_monitor_gate drop=true ! "
       "audioconvert ! audioresample ! audio/x-raw,rate=32000,channels=2 ! "
       "lamemp3enc target=bitrate bitrate=96 cbr=true ! "
       "appsink name=audio_monitor max-buffers=12 drop=true sync=false async=false " if audio_monitor else "")
)
loop = GLib.MainLoop()
source = "fallback"
previous = None
started = time.monotonic()
last_packet = 0
inputs = {
    name: SimpleNamespace(name=name, port=port, url=url, graph=None, retry=0, last={},
                          health="disconnected", healthy_since=None, black_since=None,
                          freeze_reference=None, freeze_since=None, silent_since=None,
                          audio_level=None, reported_audio_level=None,
                          audio_mode="follow", gain_db=0, gain=1,
                          pcm=deque(maxlen=input_audio_queue_buffers), tail=b"")
    for name, port, url in [("obs", in_port, input_url), ("obs2", second_port, None)]
    if port
}
watermark_revision = 0
ticker_revision = 0
ticker = None
ads_revision = 0
visible_ads = []
ad_ready = [False] * 4


def record_program():
    global recording_state
    sink = pipeline.get_by_name("recording")
    try:
        with open(recording_path, "xb") as output:
            recording_state = "recording"
            while True:
                sample = sink.emit("try-pull-sample", 0 if recording_stop.is_set() else 100 * Gst.MSECOND)
                if sample:
                    buffer = sample.get_buffer()
                    output.write(buffer.extract_dup(0, buffer.get_size()))
                elif recording_stop.is_set():
                    break
        recording_state = "completed"
    except OSError:
        recording_state = "failed"


def stop_srt(destination):
    graph = destination.graph
    destination.graph = None
    if graph:
        graph.set_state(Gst.State.NULL)


def push_transport(sink, destination):
    sample = sink.emit("pull-sample")
    graph = destination.graph
    if sample and graph:
        graph.get_by_name("sender").emit("push-buffer", sample.get_buffer())
    return Gst.FlowReturn.OK


def push_hls_sample(sink, track):
    sample = sink.emit("pull-sample")
    graph = hls.graph
    if sample and graph:
        graph.get_by_name(track).emit("push-sample", sample)
    return Gst.FlowReturn.OK


def run_hls():
    graph = None
    try:
        graph = Gst.parse_launch(
            'appsrc name=video is-live=true format=time handle-segment-change=true max-buffers=64 leaky-type=downstream ! segments.video '
            'appsrc name=audio is-live=true format=time handle-segment-change=true max-buffers=128 leaky-type=downstream ! segments.audio '
            'hlssink2 name=segments playlist-length=5 max-files=7 target-duration=2 send-keyframe-requests=false'
        )
        segments = graph.get_by_name("segments")
        playlist = hls_path / "index.m3u8"
        segments.set_property("playlist-location", str(playlist))
        segments.set_property("location", str(hls_path / "segment%05d.ts"))
        if graph.set_state(Gst.State.PLAYING) == Gst.StateChangeReturn.FAILURE:
            raise RuntimeError("HLS startup failed")
        hls.graph = graph
        hls_started.set()
        bus = graph.get_bus()
        started_at = time.monotonic()
        while not hls_stop.wait(0.25):
            message = bus.pop_filtered(Gst.MessageType.ERROR | Gst.MessageType.EOS)
            if message:
                description = message.parse_error()[0].message if message.type == Gst.MessageType.ERROR else "end of stream"
                print(f"HLS packaging stopped: {description}", file=sys.stderr, flush=True)
                hls.state = "failed"
                break
            if playlist.is_file() and time.time() - playlist.stat().st_mtime < 12:
                hls.state = "ready"
            elif time.monotonic() - started_at > 12:
                hls.state = "failed"
                break
    except (GLib.Error, OSError, RuntimeError) as error:
        print(f"HLS packaging failed: {error}", file=sys.stderr, flush=True)
        hls.state = "failed"
    finally:
        hls_started.set()
        hls.graph = None
        if graph:
            graph.set_state(Gst.State.NULL)


def service_srt(destination, now):
    graph = destination.graph
    if not graph:
        if now < destination.retry:
            return
        try:
            graph = Gst.parse_launch(
                'appsrc name=sender is-live=true format=time max-buffers=32 leaky-type=downstream '
                'caps="video/mpegts,systemstream=true,packetsize=188" ! '
                'srtsink name=remote auto-reconnect=false wait-for-connection=true sync=false async=false'
            )
            graph.get_by_name("remote").set_property("uri", destination.url)
            if graph.set_state(Gst.State.PLAYING) == Gst.StateChangeReturn.FAILURE:
                raise RuntimeError("SRT startup failed")
            destination.graph = graph
            destination.state = "connecting"
            destination.sent_bytes = 0
            destination.progress = now
        except (GLib.Error, RuntimeError):
            if graph:
                graph.set_state(Gst.State.NULL)
            destination.state, destination.retry = "retrying", now + 2
        return
    stats = graph.get_by_name("remote").get_property("stats")
    sent = stats.get_value("bytes-sent-total") if stats and stats.has_field("bytes-sent-total") else 0
    if sent > destination.sent_bytes:
        destination.state, destination.progress = "sending", now
    destination.sent_bytes = sent
    error = graph.get_bus().pop_filtered(Gst.MessageType.ERROR | Gst.MessageType.EOS)
    if error or now - destination.progress > 6:
        destination.state, destination.retry = "retrying", now + 2
        stop_srt(destination)


def run_srt(destination):
    try:
        while not srt_stop.wait(0.08):
            service_srt(destination, time.monotonic())
    finally:
        stop_srt(destination)
audio_sample = 0
scene_audio = None
external_audio_pcm = deque(maxlen=16)
external_audio_mode = "off"
silence = bytes(3840)
audio_lock = threading.Lock()


def audio_routed(feed):
    if external_audio_mode == "replace":
        return False
    return feed.health == "ready" and (
        feed.audio_mode == "on" or (feed.audio_mode == "follow" and source == feed.name)
    )


def clear_audio(feed):
    feed.pcm.clear()
    feed.tail = b""


def input_pcm(feed):
    while len(feed.tail) < len(silence) and feed.pcm:
        feed.tail += feed.pcm.popleft()
    chunk = feed.tail[:len(silence)].ljust(len(silence), b"\x00")
    feed.tail = feed.tail[len(silence):]
    return chunk


def mix_audio(tracks):
    if not tracks:
        return silence
    if len(tracks) == 1 and tracks[0][1] == 1:
        return tracks[0][0]
    samples = [0.0] * (len(silence) // 2)
    for chunk, gain in tracks:
        for index, (value,) in enumerate(struct.iter_unpack("<h", chunk)):
            samples[index] += value * gain
    return struct.pack(f"<{len(samples)}h", *(max(-32768, min(32767, round(value))) for value in samples))


def feed_local_audio(appsrc, _length):
    global audio_sample
    with audio_lock:
        active = scene_audio if (source == "scene" and external_audio_mode != "replace") else None
        tracks = [(input_pcm(feed), feed.gain) for feed in inputs.values() if audio_routed(feed)]
        ext_chunk = external_audio_pcm.popleft() if (external_audio_mode in ("replace", "mix") and external_audio_pcm) else None
    if active:
        pcm, start = active
        index = ((audio_sample - start) * 4) % len(pcm)
        tracks.append((pcm[index:index + len(silence)], 1))
    if ext_chunk:
        tracks.append((ext_chunk[:len(silence)].ljust(len(silence), b"\x00"), 1.0))
    buffer = Gst.Buffer.new_wrapped(mix_audio(tracks))
    buffer.pts = Gst.util_uint64_scale(audio_sample, Gst.SECOND, 48000)
    buffer.duration = 20 * Gst.MSECOND
    audio_sample += 960
    appsrc.emit("push-buffer", buffer)


def apply_ads(packet):
    global ads_revision, visible_ads
    visible = []
    for index in range(4):
        overlay = pipeline.get_by_name(f"ad{index}")
        if index >= len(packet["adLayers"]) or packet["adLayers"][index] is None:
            overlay.set_property("alpha", 0.0)
            continue
        layer = packet["adLayers"][index]
        if "bitmap" in layer:
            ad_ready[index] = False
            if layer["bitmap"]:
                loader = GdkPixbuf.PixbufLoader.new_with_type("png" if layer["kind"] == "image" else "jpeg")
                try:
                    loader.write(base64.b64decode(layer["bitmap"]))
                    loader.close()
                    overlay.set_property("pixbuf", loader.get_pixbuf())
                    ad_ready[index] = True
                except GLib.Error:
                    pass  # A damaged creative leaves its own placement transparent.
        for prop, key in (("offset-x", "x"), ("offset-y", "y"), ("overlay-width", "w"), ("overlay-height", "h")):
            overlay.set_property(prop, layer[key])
        overlay.set_property("alpha", layer["alpha"] if ad_ready[index] else 0.0)
        if ad_ready[index] and layer["alpha"] > 0:
            visible.append(layer["placement"])
    visible_ads = visible
    ads_revision = packet["revision"]


def apply_watermark(packet):
    global watermark_revision
    overlay = pipeline.get_by_name("watermark")
    if packet["bitmap"]:
        loader = GdkPixbuf.PixbufLoader.new_with_type("png")
        loader.write(base64.b64decode(packet["bitmap"]))
        loader.close()
        overlay.set_property("pixbuf", loader.get_pixbuf())
        overlay.set_property("alpha", 1.0)
    else:
        overlay.set_property("alpha", 0.0)
    watermark_revision = packet["revision"]


def report(reply=None):
    global previous
    status = dict(state="running" if last_packet else "starting", source=source, obs=inputs["obs"].health,
                  watermarkRevision=watermark_revision, adsRevision=ads_revision, visibleAds=visible_ads,
                  tickerRevision=ticker_revision,
                  recording=recording_state,
                  srtStates={destination.id: destination.state for destination in srt_destinations},
                  inputAudioDbfs=inputs["obs"].reported_audio_level,
                  programAudioDbfs=reported_program_audio,
                  audioMonitorAvailable=audio_monitor,
                  inputAudioMix={name: {"mode": feed.audio_mode, "gainDb": feed.gain_db, "routed": audio_routed(feed)}
                                 for name, feed in inputs.items()},
                  programGainDb=program_gain_db,
                  programMuted=pipeline.get_by_name("program_volume").get_property("mute"))
    if second_port:
        status["obs2"] = inputs["obs2"].health
        status["input2AudioDbfs"] = inputs["obs2"].reported_audio_level
    if hls_path:
        status["hls"] = hls.state
    if reply or status != previous:
        print(json.dumps(dict(status=status, reply=reply)), flush=True)
        previous = status


fade_timer = None


def reset_fade():
    global fade_timer
    if fade_timer is not None:
        GLib.source_remove(fade_timer)
        fade_timer = None


def set_fade(enabled):
    global fade_timer
    reset_fade()
    filter_element = pipeline.get_by_name("scene_fade")
    filter_element.set_property("alpha", 1.0 if enabled else 0.0)
    if not enabled:
        return
    started_at = time.monotonic()

    def step():
        global fade_timer
        progress = min(1.0, (time.monotonic() - started_at) / 0.6)
        filter_element.set_property("alpha", 1.0 - progress)
        if progress >= 1:
            fade_timer = None
            return False
        return True

    fade_timer = GLib.timeout_add(40, step)


def select(name, fade=False):
    global source, scene_audio
    set_fade(fade)
    element = pipeline.get_by_name("v")
    element.set_property("active-pad", element.get_static_pad({"obs": "sink_1", "obs2": "sink_2"}.get(name, "sink_0")))
    with audio_lock:
        for feed in inputs.values():
            if feed.audio_mode == "follow" and feed.name in (source, name) and source != name:
                clear_audio(feed)
        source = name
    if name != "scene":
        scene_audio = None
        for overlay in ("scenevideo", "sceneimage"):
            pipeline.get_by_name(overlay).set_property("alpha", 0.0)


def scene_pixbuf(bitmap, kind):
    loader = GdkPixbuf.PixbufLoader.new_with_type(kind)
    loader.write(base64.b64decode(bitmap))
    loader.close()
    return loader.get_pixbuf()


def render_scene_preview(config):
    interpolation = GdkPixbuf.InterpType.BILINEAR
    picture = scene_pixbuf(config["video"], "jpeg").scale_simple(width, height, interpolation)
    if config["image"]:
        logo = scene_pixbuf(config["image"], "png")
        x, y = config["x"], config["y"]
        w, h = min(config["w"], width - x), min(config["h"], height - y)
        logo.composite(picture, x, y, w, h, x, y,
                       config["w"] / logo.get_width(), config["h"] / logo.get_height(), interpolation, 255)
    preview = picture.scale_simple(320, 180, interpolation)
    _, encoded = preview.save_to_bufferv("jpeg", [], [])
    return "data:image/jpeg;base64," + base64.b64encode(encoded).decode("ascii")


def apply_scene(config):
    global scene_audio
    picture = scene_pixbuf(config["video"], "jpeg")
    background = pipeline.get_by_name("scenevideo")
    background.set_property("pixbuf", picture)
    background.set_property("overlay-width", width)
    background.set_property("overlay-height", height)
    image = pipeline.get_by_name("sceneimage")
    if config["image"]:
        image.set_property("pixbuf", scene_pixbuf(config["image"], "png"))
        for prop, key in (("offset-x", "x"), ("offset-y", "y"), ("overlay-width", "w"), ("overlay-height", "h")):
            image.set_property(prop, config[key])
    select("scene", config.get("fade", False))
    pcm = base64.b64decode(config["audio"])
    size = config["audioBytes"]
    scene_audio = (pcm[:size].ljust(size, b"\x00"), audio_sample) if pcm else None
    background.set_property("alpha", 1.0)
    image.set_property("alpha", 1.0 if config["image"] else 0.0)


def draw_ticker():
    if ticker is None:
        return True
    image, speed, direction, started_at = ticker
    strip_width = image.get_width()
    strip_height = image.get_height()
    travel = int((time.monotonic() - started_at) * speed) % (width + strip_width)
    x = width - travel if direction == "left" else travel - strip_width
    strip = GdkPixbuf.Pixbuf.new(GdkPixbuf.Colorspace.RGB, True, 8, width, strip_height)
    strip.fill(0x111827ff)
    start_x = max(0, x)
    visible = min(width, x + strip_width) - start_x
    if visible > 0:
        image.copy_area(start_x - x, 0, visible, strip_height, strip, start_x, 0)
    pipeline.get_by_name("ticker").set_property("pixbuf", strip)
    return True


def apply_ticker(packet):
    global ticker, ticker_revision
    overlay = pipeline.get_by_name("ticker")
    if packet["bitmap"]:
        image = scene_pixbuf(packet["bitmap"], "png")
        settings = packet["settings"]
        ticker = (image, settings["speed"], settings["direction"], time.monotonic())
        overlay.set_property("offset-y", height - image.get_height())
        draw_ticker()
        overlay.set_property("alpha", 1.0)
    else:
        ticker = None
        overlay.set_property("alpha", 0.0)
    ticker_revision = packet["revision"]


def command(line):
    global program_gain_db
    action = line.strip()
    if action.startswith("{"):
        packet = json.loads(action)
        if "scenePreview" in packet:
            try:
                preview = render_scene_preview(packet["scenePreview"])
            except (GLib.Error, ValueError):
                preview = None
            print(json.dumps({"scenePreview": preview, "previewId": packet["previewId"]}), flush=True)
            return False
        if "scene" in packet or "sceneFrame" in packet:
            reply = None
            try:
                if "scene" in packet:
                    apply_scene(packet["scene"])
                    reply = "applied"
                elif source == "scene":
                    if not packet["sceneFrame"]:
                        select("fallback")
                    else:
                        pipeline.get_by_name("scenevideo").set_property("pixbuf", scene_pixbuf(packet["sceneFrame"], "jpeg"))
            except GLib.Error:
                select("fallback")
                reply = "sceneUnavailable"
            print('{"sceneReceived":true}', flush=True)
            report(reply)
        elif "audioMonitor" in packet:
            if audio_monitor:
                pipeline.get_by_name("audio_monitor_gate").set_property("drop", not packet["audioMonitor"])
            return False
        elif "inputAudio" in packet:
            config = packet["inputAudio"]
            feed = inputs.get(config["input"])
            if feed:
                with audio_lock:
                    if feed.audio_mode != config["mode"]:
                        clear_audio(feed)
                    feed.audio_mode = config["mode"]
                    feed.gain_db = config["gainDb"]
                    feed.gain = 10 ** (feed.gain_db / 20)
                report("applied")
            else:
                report("unavailable")
        elif "gainDb" in packet:
            program_gain_db = packet["gainDb"]
            pipeline.get_by_name("program_volume").set_property("volume", 10 ** (program_gain_db / 20))
            report("applied")
        elif "externalAudioFrame" in packet:
            global external_audio_mode
            with audio_lock:
                external_audio_mode = packet.get("mode", "mix")
                raw = base64.b64decode(packet["externalAudioFrame"]) if packet["externalAudioFrame"] else b""
                if raw:
                    for offset in range(0, len(raw), len(silence)):
                        external_audio_pcm.append(raw[offset:offset + len(silence)].ljust(len(silence), b"\x00"))
                elif external_audio_mode == "off":
                    external_audio_pcm.clear()
            return False
        elif "adLayers" in packet:
            apply_ads(packet)
            print('{"adsReceived":true}', flush=True)
        elif "ticker" in packet:
            apply_ticker(packet["ticker"])
        else:
            apply_watermark(packet)
        report()
    elif action == "stop":
        loop.quit()
    elif action in ("mute", "unmute"):
        pipeline.get_by_name("program_volume").set_property("mute", action == "mute")
        report("applied")
    elif action in ("obs", "obs-fade", "obs2", "obs2-fade", "fallback"):
        target = action.removesuffix("-fade")
        if target != "fallback" and (target not in inputs or inputs[target].health != "ready"):
            report("unavailable")
        else:
            select(target, action.endswith("-fade"))
            report("applied")
    return False


def read_commands():
    for line in sys.stdin:
        GLib.idle_add(command, line)
    GLib.idle_add(loop.quit)


def pcm_power(buffer):
    data = buffer.extract_dup(0, buffer.get_size())
    count = len(data) // 2
    return sum(value * value for (value,) in struct.iter_unpack("<h", data)) / count if count else 0


def dbfs(power):
    return round(max(-90, 10 * math.log10(max(power / 32768 ** 2, 1e-9))))


def arrived(pad, info, kind, feed):
    global last_packet
    now = time.monotonic()
    if kind == "output":
        last_packet = now
    else:
        feed.last[kind] = now
    return Gst.PadProbeReturn.OK


def capture_input_audio(_sink, buffer, _pad, feed):
    now = time.monotonic()
    power = pcm_power(buffer)
    with audio_lock:
        if audio_routed(feed):
            feed.pcm.append(buffer.extract_dup(0, buffer.get_size()))
    feed.audio_level = dbfs(power)
    if power >= 32.768 ** 2:
        feed.silent_since = None
    elif feed.silent_since is None:
        feed.silent_since = now
    feed.last["audio"] = now


def watch(graph, element, kind, feed=None):
    types = Gst.PadProbeType.BUFFER | Gst.PadProbeType.BUFFER_LIST
    graph.get_by_name(element).get_static_pad("sink").add_probe(types, arrived, kind, feed)


def measure_program_audio(_pad, info):
    global program_audio
    program_audio = (time.monotonic(), dbfs(pcm_power(info.get_buffer())))
    return Gst.PadProbeReturn.OK


def open_input(feed):
    source_element = (
        'souphttpsrc name=url_input is-live=true automatic-redirect=false ssl-strict=true http-log-level=none retries=0 timeout=5 ! '
        if feed.url else f'udpsrc address={input_host} port={feed.port} reuse=false ! '
    )
    graph = Gst.parse_launch(
        source_element + 'video/mpegts,systemstream=true,packetsize=188 ! '
        'tsdemux latency=80 name=d '
        f'd. ! video/x-h264 ! queue ! h264parse ! avdec_h264 ! videoconvert ! videoscale ! videorate ! {video} ! '
        'tee name=contribution '
        f'contribution. ! queue ! intervideosink name=picture channel={feed.name} sync=true async=false '
        'contribution. ! queue leaky=downstream max-size-buffers=1 ! videorate drop-only=true ! videoscale ! '
        'video/x-raw,width=320,height=180,framerate=2/1 ! jpegenc ! '
        'appsink name=input_preview max-buffers=1 drop=true sync=false async=false '
        f'd. ! audio/mpeg,mpegversion=4 ! queue ! aacparse ! avdec_aac ! audioconvert ! audioresample ! {audio} ! '
        'fakesink name=sound signal-handoffs=true sync=true async=false'
    )
    if feed.url:
        source = graph.get_by_name("url_input")
        source.set_property("location", feed.url)
        if initial.get("inputProxy"):
            source.set_property("proxy", initial["inputProxy"])
    watch(graph, "picture", "video", feed)
    graph.get_by_name("sound").connect("handoff", capture_input_audio, feed)
    graph.set_state(Gst.State.PLAYING)
    return graph


def emit_preview(graph, name, key):
    sample = graph.get_by_name(name).emit("try-pull-sample", 0)
    if sample:
        buf = sample.get_buffer()
        jpeg = base64.b64encode(buf.extract_dup(0, buf.get_size())).decode("ascii")
        print(json.dumps({key: "data:image/jpeg;base64," + jpeg}), flush=True)
        return jpeg
    return None


def picture_samples(jpeg):
    image = scene_pixbuf(jpeg, "jpeg")
    pixels = image.get_pixels()
    stride = image.get_rowstride()
    channels = image.get_n_channels()
    return [pixels[i:i + 3] for y in range(4, image.get_height(), 8)
            for x in range(4, image.get_width(), 8) for i in (y * stride + x * channels,)]


def input_fresh(feed, now):
    return all(now - feed.last.get(kind, -100) < 1 for kind in ("audio", "video"))


def take_backup(feed, now):
    if source != feed.name:
        return
    secondary = inputs.get("obs2")
    if auto_backup and feed.name == "obs" and secondary and secondary.health == "ready" and input_fresh(secondary, now):
        select("obs2")
    else:
        select("fallback")


def service_input(feed, now, meter_due):
    was_ready = feed.health == "ready"
    if feed.graph is None and now >= feed.retry:
        try:
            feed.graph = open_input(feed)
        except GLib.Error as error:
            print(f"Contribution decoder unavailable: {error.message}", file=sys.stderr)
            feed.retry = now + 5
    failed = feed.graph and feed.graph.get_bus().pop_filtered(Gst.MessageType.ERROR | Gst.MessageType.EOS)
    fresh = input_fresh(feed, now)
    if failed or not fresh:
        feed.reported_audio_level = None
        feed.black_since = None
        feed.freeze_reference = feed.freeze_since = None
        feed.healthy_since = None
        feed.health = "disconnected"
        if feed.graph and (failed or (feed.last and now - min(feed.last.values()) >= 1)):
            feed.graph.set_state(Gst.State.NULL)
            feed.graph = None
            feed.last.clear()
            feed.silent_since = None
            feed.audio_level = None
            feed.retry = now + (1 if feed.url else 0.2)
    else:
        if meter_due:
            feed.reported_audio_level = feed.audio_level
        jpeg = emit_preview(feed.graph, "input_preview", "inputPreview" if feed.name == "obs" else "input2Preview") if feed.graph else None
        samples = picture_samples(jpeg) if jpeg and (black_seconds or freeze_seconds) else None
        if black_seconds and samples:
            if sum(max(rgb) <= 24 for rgb in samples) < 0.99 * len(samples):
                feed.black_since = None
            elif feed.black_since is None:
                feed.black_since = now
        if freeze_seconds and samples:
            changed = feed.freeze_reference is None or any(
                any(abs(a - b) > 12 for a, b in zip(current, old))
                for current, old in zip(samples, feed.freeze_reference)
            )
            if changed:
                feed.freeze_reference, feed.freeze_since = samples, now
        black = feed.black_since is not None and now - feed.black_since >= black_seconds
        frozen = feed.freeze_since is not None and now - feed.freeze_since >= freeze_seconds
        silence_start = feed.silent_since
        silent = silence_seconds > 0 and silence_start is not None and now - silence_start >= silence_seconds
        if black or frozen or silent:
            feed.healthy_since = None
            feed.health = "black" if black else "frozen" if frozen else "silent"
        else:
            if feed.healthy_since is None:
                feed.healthy_since = now
            feed.health = "ready" if now - feed.healthy_since >= 5 else "warming"
    if was_ready and feed.health != "ready":
        with audio_lock:
            clear_audio(feed)


def tick():
    global reported_program_audio, next_meter_update
    now = time.monotonic()
    meter_due = now >= next_meter_update
    if meter_due:
        reading = program_audio
        reported_program_audio = reading[1] if reading and now - reading[0] < 1 else None
        next_meter_update = now + 0.5
    emit_preview(pipeline, "preview", "preview")
    emit_preview(pipeline, "program_monitor", "programMonitor")
    if audio_monitor:
        sink = pipeline.get_by_name("audio_monitor")
        chunks = []
        for _ in range(12):
            sample = sink.emit("try-pull-sample", 0)
            if not sample:
                break
            buf = sample.get_buffer()
            chunks.append(buf.extract_dup(0, buf.get_size()))
        if chunks:
            data = base64.b64encode(b"".join(chunks)).decode("ascii")
            print(json.dumps({"programAudio": data}), flush=True)
    error = pipeline.get_bus().pop_filtered(Gst.MessageType.ERROR)
    if error or now - (last_packet or started) > 8:
        print(error.parse_error() if error else "Program mux stopped producing packets", file=sys.stderr)
        loop.quit()
        return False
    for feed in inputs.values():
        service_input(feed, now, meter_due)
    active = inputs.get(source)
    if active and active.health != "ready":
        take_backup(active, now)
    report()
    return True


watch(pipeline, "output", "output")
pipeline.get_by_name("program_meter").get_static_pad("sink").add_probe(
    Gst.PadProbeType.BUFFER, measure_program_audio)
pipeline.get_by_name("local_audio").connect("need-data", feed_local_audio)
for destination in srt_destinations:
    sink = pipeline.get_by_name(f"srt_{destination.id}")
    sink.set_property("emit-signals", True)
    sink.connect("new-sample", push_transport, destination)
if hls_path:
    for track in ("video", "audio"):
        sink = pipeline.get_by_name(f"hls_{track}")
        sink.set_property("emit-signals", True)
        sink.connect("new-sample", push_hls_sample, track)
fade_image = GdkPixbuf.Pixbuf.new(GdkPixbuf.Colorspace.RGB, False, 8, 1, 1)
fade_image.fill(0x000000ff)
fade_layer = pipeline.get_by_name("scene_fade")
fade_layer.set_property("pixbuf", fade_image)
fade_layer.set_property("overlay-width", width)
fade_layer.set_property("overlay-height", height)
select("fallback")
apply_watermark(initial)
if initial.get("ticker"):
    apply_ticker(initial["ticker"])
hls_thread = None
if hls_path:
    hls_thread = threading.Thread(target=run_hls, daemon=True)
    hls_thread.start()
    hls_started.wait(1)
pipeline.set_state(Gst.State.PLAYING)
srt_threads = []
for destination in srt_destinations:
    thread = threading.Thread(target=run_srt, args=(destination,), daemon=True)
    thread.start()
    srt_threads.append(thread)
recorder = None
if recording_path:
    recorder = threading.Thread(target=record_program, daemon=True)
    recorder.start()
GLib.timeout_add(80, tick)
GLib.timeout_add(40, draw_ticker)
threading.Thread(target=read_commands, daemon=True).start()
try:
    loop.run()
finally:
    if hls_thread:
        hls_stop.set()
        hls_thread.join(timeout=1)
    srt_stop.set()
    for thread in srt_threads:
        thread.join(timeout=1)
    if recorder:
        recording_stop.set()
        recorder.join(timeout=1)
        print(json.dumps({"recordingFinal": recording_state}), flush=True)
    for feed in inputs.values():
        if feed.graph:
            feed.graph.set_state(Gst.State.NULL)
    pipeline.set_state(Gst.State.NULL)
