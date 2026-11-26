"""Single-station MPEG-TS worker. The Node supervisor owns stdin."""
import json
import base64
import sys
import struct
import math
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
srt_url = initial.get("srtUrl")
srt_state = "connecting" if srt_url else "disabled"
srt_graph = None
srt_retry = 0
srt_bytes = 0
srt_progress = 0
srt_stop = threading.Event()
recording_state = "starting" if recording_path else "disabled"
recording_stop = threading.Event()
width, height = initial["canvas"]["width"], initial["canvas"]["height"]
video = f"video/x-raw,format=I420,width={width},height={height},framerate=25/1,pixel-aspect-ratio=1/1"
audio = "audio/x-raw,format=S16LE,layout=interleaved,rate=48000,channels=2"
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
    "bitrate=2500 key-int-max=25 bframes=0 ! h264parse config-interval=-1 ! queue ! mux. "
    f"appsrc name=local_audio is-live=true format=time max-bytes=7680 caps=\"{audio}\" ! clocksync ! "
    f"volume name=program_volume ! {audio} ! "
    "audioconvert name=program_meter ! avenc_aac ! aacparse ! queue ! mux. "
    "mpegtsmux name=mux alignment=7 ! tee name=delivery "
    f"delivery. ! queue ! udpsink name=output host=127.0.0.1 port={out_port} sync=false async=false "
    + ("delivery. ! queue leaky=downstream max-size-buffers=64 max-size-time=0 max-size-bytes=0 ! "
       "appsink name=recording max-buffers=64 drop=true sync=false async=false " if recording_path else "")
    + ("delivery. ! queue leaky=downstream max-size-buffers=32 ! "
       "appsink name=srt_buffer max-buffers=32 drop=true sync=false async=false " if srt_url else "")
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
                          audio_level=None, reported_audio_level=None)
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


def stop_srt():
    global srt_graph
    if srt_graph:
        srt_graph.set_state(Gst.State.NULL)
        srt_graph = None


def push_srt(_sink):
    sample = _sink.emit("pull-sample")
    graph = srt_graph
    if sample and graph:
        graph.get_by_name("sender").emit("push-buffer", sample.get_buffer())
    return Gst.FlowReturn.OK


def service_srt(now):
    global srt_graph, srt_state, srt_retry, srt_bytes, srt_progress
    if not srt_url:
        return
    if not srt_graph:
        if now < srt_retry:
            return
        try:
            graph = Gst.parse_launch(
                'appsrc name=sender is-live=true format=time max-buffers=32 leaky-type=downstream '
                'caps="video/mpegts,systemstream=true,packetsize=188" ! '
                'srtsink name=remote auto-reconnect=false wait-for-connection=true sync=false async=false'
            )
            graph.get_by_name("remote").set_property("uri", srt_url)
            if graph.set_state(Gst.State.PLAYING) == Gst.StateChangeReturn.FAILURE:
                graph.set_state(Gst.State.NULL)
                raise RuntimeError("SRT startup failed")
            srt_graph = graph
            srt_state, srt_bytes, srt_progress = "connecting", 0, now
        except (GLib.Error, RuntimeError):
            srt_state, srt_retry = "retrying", now + 2
        return
    stats = srt_graph.get_by_name("remote").get_property("stats")
    sent = stats.get_value("bytes-sent-total") if stats and stats.has_field("bytes-sent-total") else 0
    if sent > srt_bytes:
        srt_state, srt_progress = "sending", now
    srt_bytes = sent
    error = srt_graph.get_bus().pop_filtered(Gst.MessageType.ERROR | Gst.MessageType.EOS)
    if error or now - srt_progress > 6:
        stop_srt()
        srt_state, srt_retry = "retrying", now + 2


def run_srt():
    try:
        while not srt_stop.wait(0.08):
            service_srt(time.monotonic())
    finally:
        stop_srt()
audio_sample = 0
scene_audio = None
silence = bytes(3840)
contribution_audio = deque(maxlen=12)
audio_lock = threading.Lock()
contribution_tail = b""


def feed_local_audio(appsrc, _length):
    global audio_sample, contribution_tail
    active = scene_audio
    chunk = silence
    if source in inputs:
        with audio_lock:
            while len(contribution_tail) < len(silence) and contribution_audio:
                contribution_tail += contribution_audio.popleft()
            chunk = contribution_tail[:len(silence)].ljust(len(silence), b"\x00")
            contribution_tail = contribution_tail[len(silence):]
    elif active:
        pcm, start = active
        index = ((audio_sample - start) * 4) % len(pcm)
        chunk = pcm[index:index + len(silence)]
    buffer = Gst.Buffer.new_wrapped(chunk)
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
                  recording=recording_state, srt=srt_state, inputAudioDbfs=inputs["obs"].reported_audio_level,
                  programAudioDbfs=reported_program_audio,
                  programGainDb=program_gain_db,
                  programMuted=pipeline.get_by_name("program_volume").get_property("mute"))
    if second_port:
        status["obs2"] = inputs["obs2"].health
        status["input2AudioDbfs"] = inputs["obs2"].reported_audio_level
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
    global source, scene_audio, contribution_tail
    set_fade(fade)
    element = pipeline.get_by_name("v")
    element.set_property("active-pad", element.get_static_pad({"obs": "sink_1", "obs2": "sink_2"}.get(name, "sink_0")))
    with audio_lock:
        contribution_tail = b""
        contribution_audio.clear()
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
        elif "gainDb" in packet:
            program_gain_db = packet["gainDb"]
            pipeline.get_by_name("program_volume").set_property("volume", 10 ** (program_gain_db / 20))
            report("applied")
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
        if kind == "audio" and info.type & Gst.PadProbeType.BUFFER:
            # Measure normalized stereo PCM against -60 dBFS RMS.
            power = pcm_power(info.get_buffer())
            with audio_lock:
                if source == feed.name:
                    buffer = info.get_buffer()
                    contribution_audio.append(buffer.extract_dup(0, buffer.get_size()))
            feed.audio_level = dbfs(power)
            if power >= 32.768 ** 2:
                feed.silent_since = None
            elif feed.silent_since is None:
                feed.silent_since = now
        feed.last[kind] = now
    return Gst.PadProbeReturn.OK


def watch(graph, element, kind, feed=None):
    types = Gst.PadProbeType.BUFFER | Gst.PadProbeType.BUFFER_LIST
    graph.get_by_name(element).get_static_pad("sink").add_probe(types, arrived, kind, feed)


def measure_program_audio(_pad, info):
    global program_audio
    program_audio = (time.monotonic(), dbfs(pcm_power(info.get_buffer())))
    return Gst.PadProbeReturn.OK


def open_input(feed):
    source_element = (
        'souphttpsrc name=url_input is-live=true automatic-redirect=false retries=0 timeout=5 ! '
        if feed.url else f'udpsrc address={input_host} port={feed.port} reuse=false ! '
    )
    graph = Gst.parse_launch(
        source_element + 'video/mpegts,systemstream=true,packetsize=188 ! '
        'tsdemux latency=80 name=d '
        f'd. ! video/x-h264 ! queue ! h264parse ! avdec_h264 ! videoconvert ! videoscale ! videorate ! {video} ! '
        'tee name=contribution '
        f'contribution. ! queue ! intervideosink name=picture channel={feed.name} sync=false async=false '
        'contribution. ! queue leaky=downstream max-size-buffers=1 ! videorate drop-only=true ! videoscale ! '
        'video/x-raw,width=320,height=180,framerate=2/1 ! jpegenc ! '
        'appsink name=input_preview max-buffers=1 drop=true sync=false async=false '
        f'd. ! audio/mpeg,mpegversion=4 ! queue ! aacparse ! avdec_aac ! audioconvert ! audioresample ! {audio} ! '
        'fakesink name=sound sync=false async=false'
    )
    if feed.url:
        graph.get_by_name("url_input").set_property("location", feed.url)
    watch(graph, "picture", "video", feed)
    watch(graph, "sound", "audio", feed)
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
if srt_url:
    sink = pipeline.get_by_name("srt_buffer")
    sink.set_property("emit-signals", True)
    sink.connect("new-sample", push_srt)
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
pipeline.set_state(Gst.State.PLAYING)
srt_thread = None
if srt_url:
    srt_thread = threading.Thread(target=run_srt, daemon=True)
    srt_thread.start()
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
    if srt_thread:
        srt_stop.set()
        srt_thread.join(timeout=1)
    if recorder:
        recording_stop.set()
        recorder.join(timeout=1)
        print(json.dumps({"recordingFinal": recording_state}), flush=True)
    for feed in inputs.values():
        if feed.graph:
            feed.graph.set_state(Gst.State.NULL)
    pipeline.set_state(Gst.State.NULL)
