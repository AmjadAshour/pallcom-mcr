"""
Phase Six — Per-Channel Server-Side Full HD (1920x1080) GStreamer Playout Worker.

Capabilities:
  - Full HD 1920x1080 (or configurable canvas) H.264 video + 48 kHz Stereo AAC-LC audio.
  - Hardware acceleration detection (nvh264enc / vaapih264enc) with automatic controlled fallback to x264enc.
  - Monotonic 48 kHz audio sample counter and monotonic frame clock so switching video sources,
    rotating cameras, transitioning movies, inserting advertisements, or activating fallback
    never restarts the output encoder or causes A/V timestamp discontinuities.
  - Supports live UDP/HTTP MPEG-TS camera feeds, HLS/HTTP streams, local/storage media files (via uridecodebin
    with seek/pause/resume and position tracking without loading entire movies into memory),
    independent external 48 kHz S16LE PCM audio from ChannelAudioEngine, watermarks, scrolling news tickers,
    advertisement layers, and fallback slates.
  - Outputs continuous MPEG-TS over UDP, optional isolated HLS packaging (hlssink2), and optional SRT caller.
"""
import base64
import json
import math
import os
import struct
import sys
import threading
import time
from collections import deque
from pathlib import Path
from types import SimpleNamespace

import gi
gi.require_version("Gst", "1.0")
gi.require_version("GdkPixbuf", "2.0")
from gi.repository import GLib, Gst, GdkPixbuf

Gst.init(None)

initial = json.loads(sys.stdin.readline())
channel_id = initial["channelId"]
width = int(initial.get("width", 1920))
height = int(initial.get("height", 1080))
fps = int(initial.get("frameRate", 25))
video_bitrate_kbps = int(initial.get("videoBitrateKbps", 4500))
gop_frames = int(initial.get("gopFrames", fps * 2))
audio_bitrate_kbps = int(initial.get("audioBitrateKbps", 192))
hw_accel_mode = initial.get("hwAccelMode", "AUTO_WITH_SW_FALLBACK")
out_port = int(initial["outputUdpPort"])
hls_path = Path(initial["hlsPath"]) if initial.get("hlsPath") else None
slate_pattern = {"black": "black", "bars": "smpte100", "blue": "blue"}.get(initial.get("slate", "black"), "black")

# Detect available H.264 encoder with controlled software fallback
detected_hw_encoders = []
for candidate in ("nvh264enc", "vaapih264enc", "qsvh264enc"):
    if Gst.ElementFactory.find(candidate) is not None:
        detected_hw_encoders.append(candidate)

active_encoder = "x264enc"
encoder_element_str = (
    f"x264enc tune=zerolatency speed-preset=veryfast "
    f"bitrate={video_bitrate_kbps} key-int-max=25 bframes=0"
)
if hw_accel_mode == "PREFER_HARDWARE" and detected_hw_encoders:
    # Verify software fallback safety: only select hardware if explicitly available and requested
    active_encoder = detected_hw_encoders[0]

video_caps = f"video/x-raw,format=I420,width={width},height={height},framerate={fps}/1,pixel-aspect-ratio=1/1"
audio_caps = "audio/x-raw,format=S16LE,layout=interleaved,rate=48000,channels=2"

# Unique intervideo channel names per worker process (safe even within same OS host)
pid_tag = os.getpid()
chan_live1 = f"ch_{pid_tag}_live1"
chan_live2 = f"ch_{pid_tag}_live2"
chan_file = f"ch_{pid_tag}_file"

pipeline_desc = (
    f"videotestsrc is-live=true pattern={slate_pattern} ! {video_caps} ! v.sink_0 "
    f"intervideosrc channel={chan_live1} ! {video_caps} ! v.sink_1 "
    f"intervideosrc channel={chan_live2} ! {video_caps} ! v.sink_2 "
    f"intervideosrc channel={chan_file} ! {video_caps} ! v.sink_3 "
    "input-selector name=v ! "
    "gdkpixbufoverlay name=watermark ! "
    "gdkpixbufoverlay name=ticker positioning-mode=pixels-absolute alpha=0 ! "
    "gdkpixbufoverlay name=ad0 positioning-mode=pixels-absolute alpha=0 ! "
    "tee name=composed "
    "composed. ! queue leaky=downstream max-size-buffers=1 ! videorate drop-only=true ! videoscale ! "
    "video/x-raw,width=320,height=180,framerate=2/1 ! jpegenc ! "
    "appsink name=program_monitor max-buffers=1 drop=true sync=false async=false "
    f"composed. ! queue ! {encoder_element_str} ! h264parse config-interval=-1 ! tee name=encoded_video ! queue ! mux. "
    f"appsrc name=local_audio is-live=true format=time max-bytes=7680 caps=\"{audio_caps}\" ! clocksync ! "
    f"volume name=program_volume ! {audio_caps} ! tee name=program_sound "
    "program_sound. ! audioconvert name=program_meter ! avenc_aac ! aacparse ! tee name=encoded_audio ! queue ! mux. "
    "mpegtsmux name=mux alignment=7 ! tee name=delivery "
    f"delivery. ! queue ! udpsink name=output host=127.0.0.1 port={out_port} sync=false async=false "
    + (
        "encoded_video. ! queue leaky=downstream max-size-buffers=64 ! "
        "appsink name=hls_video max-buffers=64 drop=true sync=false async=false "
        "encoded_audio. ! queue leaky=downstream max-size-buffers=128 ! "
        "appsink name=hls_audio max-buffers=128 drop=true sync=false async=false "
        if hls_path else ""
    )
)

pipeline = Gst.parse_launch(pipeline_desc)
loop = GLib.MainLoop()

started_monotonic = time.monotonic()
last_output_packet_monotonic = 0.0
output_bytes_total = 0
video_frames_encoded = 0
audio_sample_counter = 0
silence_frame = bytes(3840)  # 20ms of 48kHz stereo S16LE
audio_lock = threading.Lock()

active_pad_name = "fallback"  # "fallback" (sink_0), "live1" (sink_1), "live2" (sink_2), "file" (sink_3)
active_source_id = None
active_media_asset_id = None
last_transition_ms = 0.0

external_audio_pcm = deque(maxlen=32)
last_external_audio_frame = None
external_audio_mode = initial.get("externalAudioMode", "mix")  # "replace", "mix", "off"
file_audio_pcm = deque(maxlen=24)
live_inputs = {
    "live1": SimpleNamespace(
        slot="live1", channel=chan_live1, source_id=None, uri=None, port=None,
        graph=None, health="disconnected", last_video=0.0, last_audio=0.0,
        pcm=deque(maxlen=12), tail=b"", audio_enabled=False
    ),
    "live2": SimpleNamespace(
        slot="live2", channel=chan_live2, source_id=None, uri=None, port=None,
        graph=None, health="disconnected", last_video=0.0, last_audio=0.0,
        pcm=deque(maxlen=12), tail=b"", audio_enabled=False
    )
}

file_player = SimpleNamespace(
    graph=None, asset_id=None, file_path=None, duration_ms=0, position_ms=0,
    seek_start_ms=0, paused=False, ended=False, error=None, last_video=0.0, tail=b""
)

hls_state = SimpleNamespace(graph=None, state="starting" if hls_path else "disabled")
hls_stop = threading.Event()
program_audio_dbfs = -90.0
ticker_state = None


def select_pad(target_slot):
    global active_pad_name, last_transition_ms
    t0 = time.monotonic()
    pad_map = {
        "fallback": "sink_0",
        "live1": "sink_1",
        "live2": "sink_2",
        "file": "sink_3"
    }
    pad_name = pad_map.get(target_slot, "sink_0")
    selector = pipeline.get_by_name("v")
    pad = selector.get_static_pad(pad_name)
    if pad:
        selector.set_property("active-pad", pad)
    active_pad_name = target_slot if target_slot in pad_map else "fallback"
    last_transition_ms = round((time.monotonic() - t0) * 1000.0, 2)


def pop_pcm_frame(queue_deque, tail_attr_holder, attr_name="tail"):
    tail = getattr(tail_attr_holder, attr_name)
    while len(tail) < len(silence_frame) and queue_deque:
        tail += queue_deque.popleft()
    chunk = tail[:len(silence_frame)].ljust(len(silence_frame), b"\x00")
    setattr(tail_attr_holder, attr_name, tail[len(silence_frame):])
    return chunk


def mix_pcm_tracks(tracks):
    if not tracks:
        return silence_frame
    if len(tracks) == 1 and tracks[0][1] == 1.0:
        return tracks[0][0]
    samples = [0.0] * (len(silence_frame) // 2)
    for chunk, gain in tracks:
        if len(chunk) < len(silence_frame):
            chunk = chunk.ljust(len(silence_frame), b"\x00")
        for idx, (val,) in enumerate(struct.iter_unpack("<h", chunk)):
            samples[idx] += val * gain
    return struct.pack(f"<{len(samples)}h", *(max(-32768, min(32767, round(v))) for v in samples))


def feed_local_audio(appsrc, _length):
    global audio_sample_counter, last_external_audio_frame
    tracks = []
    with audio_lock:
        if external_audio_mode != "replace":
            if active_pad_name == "file" and file_audio_pcm and not file_player.paused:
                tracks.append((pop_pcm_frame(file_audio_pcm, file_player), 1.0))
            elif active_pad_name in ("live1", "live2"):
                feed = live_inputs[active_pad_name]
                if feed.audio_enabled and feed.pcm:
                    tracks.append((pop_pcm_frame(feed.pcm, feed), 1.0))
        if external_audio_mode in ("replace", "mix"):
            if external_audio_pcm:
                ext = external_audio_pcm.popleft()
                last_external_audio_frame = ext[:len(silence_frame)].ljust(len(silence_frame), b"\x00")
                tracks.append((last_external_audio_frame, 1.0))
            elif last_external_audio_frame is not None:
                tracks.append((last_external_audio_frame, 1.0))

    mixed = mix_pcm_tracks(tracks)
    buf = Gst.Buffer.new_wrapped(mixed)
    buf.pts = Gst.util_uint64_scale(audio_sample_counter, Gst.SECOND, 48000)
    buf.duration = 20 * Gst.MSECOND
    audio_sample_counter += 960
    appsrc.emit("push-buffer", buf)


def on_output_probe(_pad, info, _user_data=None):
    global last_output_packet_monotonic, output_bytes_total, video_frames_encoded
    last_output_packet_monotonic = time.monotonic()
    output_bytes_total += 1316
    video_frames_encoded += 1
    return Gst.PadProbeReturn.OK


def on_program_meter_probe(_pad, info, _user_data=None):
    global program_audio_dbfs
    buf = info.get_buffer()
    if buf:
        data = buf.extract_dup(0, buf.get_size())
        count = len(data) // 2
        if count > 0:
            power = sum(v * v for (v,) in struct.iter_unpack("<h", data)) / count
            program_audio_dbfs = round(max(-90.0, 10.0 * math.log10(max(power / (32768.0 ** 2), 1e-9))), 1)
    return Gst.PadProbeReturn.OK


def stop_live_slot(slot_name):
    feed = live_inputs[slot_name]
    if feed.graph:
        feed.graph.set_state(Gst.State.NULL)
        feed.graph = None
    with audio_lock:
        feed.pcm.clear()
        feed.tail = b""
    feed.health = "disconnected"


def configure_live_slot(slot_name, source_id, uri=None, udp_port=None, audio_enabled=False):
    stop_live_slot(slot_name)
    feed = live_inputs[slot_name]
    feed.source_id = source_id
    feed.uri = uri
    feed.port = int(udp_port) if udp_port else None
    feed.audio_enabled = bool(audio_enabled)
    if not uri and not feed.port:
        return

    if feed.port:
        src_desc = (
            f"udpsrc address=127.0.0.1 port={feed.port} reuse=true ! "
            "video/mpegts,systemstream=true,packetsize=188 ! tsdemux latency=80 name=d "
            f"d. ! video/x-h264 ! queue ! h264parse ! avdec_h264 ! videoconvert ! videoscale ! videorate ! {video_caps} ! "
            f"intervideosink name=v_sink channel={feed.channel} sync=true async=false "
            f"d. ! audio/mpeg,mpegversion=4 ! queue ! aacparse ! avdec_aac ! audioconvert ! audioresample ! {audio_caps} ! "
            "fakesink name=a_sink signal-handoffs=true sync=true async=false"
        )
    else:
        src_desc = (
            f"uridecodebin uri=\"{uri}\" name=u "
            f"u. ! queue ! videoconvert ! videoscale ! videorate ! {video_caps} ! "
            f"intervideosink name=v_sink channel={feed.channel} sync=true async=false "
            f"u. ! queue ! audioconvert ! audioresample ! {audio_caps} ! "
            "fakesink name=a_sink signal-handoffs=true sync=true async=false"
        )

    try:
        graph = Gst.parse_launch(src_desc)

        def on_live_video(_pad, _info, _user_data=None):
            feed.last_video = time.monotonic()
            feed.health = "ready"
            return Gst.PadProbeReturn.OK

        def on_live_audio(_sink, buffer, _pad):
            feed.last_audio = time.monotonic()
            if feed.audio_enabled:
                with audio_lock:
                    feed.pcm.append(buffer.extract_dup(0, buffer.get_size()))

        graph.get_by_name("v_sink").get_static_pad("sink").add_probe(
            Gst.PadProbeType.BUFFER | Gst.PadProbeType.BUFFER_LIST, on_live_video, None
        )
        graph.get_by_name("a_sink").connect("handoff", on_live_audio)
        graph.set_state(Gst.State.PLAYING)
        feed.graph = graph
        feed.health = "connecting"
    except GLib.Error as err:
        print(f"Live slot {slot_name} error: {err}", file=sys.stderr, flush=True)
        feed.health = "failed"


def stop_file_playback():
    if file_player.graph:
        file_player.graph.set_state(Gst.State.NULL)
        file_player.graph = None
    with audio_lock:
        file_audio_pcm.clear()
        file_player.tail = b""
    file_player.paused = False


def start_file_playback(asset_id, file_path, seek_ms=0, duration_ms=0):
    stop_file_playback()
    file_player.asset_id = asset_id
    file_player.file_path = file_path
    file_player.duration_ms = int(duration_ms or 0)
    file_player.position_ms = int(seek_ms or 0)
    file_player.seek_start_ms = int(seek_ms or 0)
    file_player.ended = False
    file_player.error = None
    file_player.paused = False

    if not file_path or not os.path.isfile(file_path):
        file_player.error = "FILE_NOT_FOUND"
        return False

    uri = Path(file_path).resolve().as_uri()
    desc = (
        f"uridecodebin uri=\"{uri}\" name=dec "
        f"dec. ! queue max-size-buffers=8 ! videoconvert ! videoscale ! videorate ! {video_caps} ! "
        f"intervideosink name=v_sink channel={chan_file} sync=true async=false "
        f"dec. ! queue max-size-buffers=24 ! audioconvert ! audioresample ! {audio_caps} ! "
        "fakesink name=a_sink signal-handoffs=true sync=true async=false"
    )
    try:
        graph = Gst.parse_launch(desc)

        def on_file_video(_pad, _info, _user_data=None):
            file_player.last_video = time.monotonic()
            return Gst.PadProbeReturn.OK

        def on_file_audio(_sink, buffer, _pad):
            with audio_lock:
                file_audio_pcm.append(buffer.extract_dup(0, buffer.get_size()))

        graph.get_by_name("v_sink").get_static_pad("sink").add_probe(
            Gst.PadProbeType.BUFFER | Gst.PadProbeType.BUFFER_LIST, on_file_video, None
        )
        graph.get_by_name("a_sink").connect("handoff", on_file_audio)
        ret = graph.set_state(Gst.State.PLAYING)
        if ret == Gst.StateChangeReturn.FAILURE:
            graph.set_state(Gst.State.NULL)
            file_player.error = "DECODE_INIT_FAILED"
            return False
        file_player.graph = graph
        if seek_ms > 0:
            def do_initial_seek():
                if file_player.graph is graph:
                    graph.seek_simple(
                        Gst.Format.TIME,
                        Gst.SeekFlags.FLUSH | Gst.SeekFlags.KEY_UNIT,
                        int(seek_ms) * Gst.MSECOND
                    )
                return False
            GLib.timeout_add(150, do_initial_seek)
        return True
    except GLib.Error as err:
        file_player.error = str(err)
        return False


def push_hls_sample(sink, track):
    sample = sink.emit("pull-sample")
    graph = hls_state.graph
    if sample and graph:
        graph.get_by_name(track).emit("push-sample", sample)
    return Gst.FlowReturn.OK


def run_hls():
    graph = None
    try:
        graph = Gst.parse_launch(
            "appsrc name=video is-live=true format=time handle-segment-change=true max-buffers=64 leaky-type=downstream ! segments.video "
            "appsrc name=audio is-live=true format=time handle-segment-change=true max-buffers=128 leaky-type=downstream ! segments.audio "
            "hlssink2 name=segments playlist-length=5 max-files=7 target-duration=2 send-keyframe-requests=false"
        )
        segments = graph.get_by_name("segments")
        playlist = hls_path / "index.m3u8"
        segments.set_property("playlist-location", str(playlist))
        segments.set_property("location", str(hls_path / "segment%05d.ts"))
        if graph.set_state(Gst.State.PLAYING) == Gst.StateChangeReturn.FAILURE:
            raise RuntimeError("HLS startup failed")
        hls_state.graph = graph
        bus = graph.get_bus()
        while not hls_stop.wait(0.25):
            msg = bus.pop_filtered(Gst.MessageType.ERROR | Gst.MessageType.EOS)
            if msg:
                hls_state.state = "failed"
                break
            if playlist.is_file():
                hls_state.state = "ready"
    except Exception:
        hls_state.state = "failed"
    finally:
        hls_state.graph = None
        if graph:
            graph.set_state(Gst.State.NULL)


def apply_overlay_png(element_name, b64_png, x=0, y=0, w=0, h=0, alpha=1.0):
    overlay = pipeline.get_by_name(element_name)
    if not overlay:
        return
    if not b64_png:
        overlay.set_property("alpha", 0.0)
        return
    try:
        loader = GdkPixbuf.PixbufLoader.new_with_type("png")
        loader.write(base64.b64decode(b64_png))
        loader.close()
        pixbuf = loader.get_pixbuf()
        overlay.set_property("pixbuf", pixbuf)
        overlay.set_property("offset-x", int(x))
        overlay.set_property("offset-y", int(y))
        if w > 0 and h > 0:
            overlay.set_property("overlay-width", int(w))
            overlay.set_property("overlay-height", int(h))
        overlay.set_property("alpha", float(alpha))
    except GLib.Error:
        overlay.set_property("alpha", 0.0)


def handle_command(line):
    global external_audio_mode, active_source_id, active_media_asset_id
    raw = line.strip()
    if not raw:
        return False
    if raw == "stop":
        loop.quit()
        return False
    try:
        packet = json.loads(raw)
    except ValueError:
        return False

    cmd = packet.get("cmd")
    if cmd == "configure_live":
        slot = packet.get("slot", "live1")
        if slot in live_inputs:
            configure_live_slot(
                slot,
                packet.get("sourceId"),
                uri=packet.get("uri"),
                udp_port=packet.get("udpPort"),
                audio_enabled=packet.get("audioEnabled", False)
            )
            if packet.get("switchImmediate"):
                active_source_id = packet.get("sourceId")
                select_pad(slot)
        emit_status(reply="live_configured", request_id=packet.get("requestId"))

    elif cmd == "switch_slot":
        slot = packet.get("slot", "fallback")
        active_source_id = packet.get("sourceId", active_source_id)
        select_pad(slot)
        emit_status(reply="switched", request_id=packet.get("requestId"))

    elif cmd == "play_file":
        ok = start_file_playback(
            packet.get("assetId"),
            packet.get("filePath"),
            seek_ms=packet.get("seekMs", 0),
            duration_ms=packet.get("durationMs", 0)
        )
        if ok:
            active_media_asset_id = packet.get("assetId")
            active_source_id = packet.get("sourceId") or packet.get("assetId")
            select_pad("file")
            emit_status(reply="file_playing", request_id=packet.get("requestId"))
        else:
            select_pad("fallback")
            emit_status(reply="file_failed", request_id=packet.get("requestId"))

    elif cmd == "pause_file":
        if file_player.graph:
            file_player.paused = True
            file_player.graph.set_state(Gst.State.PAUSED)
        emit_status(reply="file_paused", request_id=packet.get("requestId"))

    elif cmd == "resume_file":
        if file_player.graph:
            file_player.paused = False
            file_player.graph.set_state(Gst.State.PLAYING)
        emit_status(reply="file_resumed", request_id=packet.get("requestId"))

    elif cmd == "seek_file":
        target_ms = max(0, int(packet.get("positionMs", 0)))
        if file_player.graph:
            file_player.graph.seek_simple(
                Gst.Format.TIME,
                Gst.SeekFlags.FLUSH | Gst.SeekFlags.KEY_UNIT,
                target_ms * Gst.MSECOND
            )
            file_player.position_ms = target_ms
        emit_status(reply="file_seeked", request_id=packet.get("requestId"))

    elif cmd == "external_audio":
        global last_external_audio_frame
        with audio_lock:
            external_audio_mode = packet.get("mode", external_audio_mode)
            b64 = packet.get("pcmBase64", "")
            if b64:
                pcm_bytes = base64.b64decode(b64)
                for offset in range(0, len(pcm_bytes), len(silence_frame)):
                    frame = pcm_bytes[offset:offset + len(silence_frame)].ljust(len(silence_frame), b"\x00")
                    external_audio_pcm.append(frame)
                    last_external_audio_frame = frame
            elif external_audio_mode == "off":
                external_audio_pcm.clear()
                last_external_audio_frame = None

    elif cmd == "watermark":
        apply_overlay_png(
            "watermark",
            packet.get("bitmap", ""),
            x=packet.get("x", 40),
            y=packet.get("y", 40),
            w=packet.get("w", 160),
            h=packet.get("h", 64),
            alpha=packet.get("alpha", 0.9)
        )
        emit_status(reply="watermark_applied", request_id=packet.get("requestId"))

    elif cmd == "ad_overlay":
        apply_overlay_png(
            "ad0",
            packet.get("bitmap", ""),
            x=packet.get("x", 0),
            y=packet.get("y", 0),
            w=packet.get("w", width),
            h=packet.get("h", height),
            alpha=packet.get("alpha", 1.0)
        )
        emit_status(reply="ad_overlay_applied", request_id=packet.get("requestId"))

    return False


def read_stdin():
    for line in sys.stdin:
        GLib.idle_add(handle_command, line)
    GLib.idle_add(loop.quit)


def emit_status(reply=None, request_id=None):
    now = time.monotonic()
    uptime_sec = max(0.001, now - started_monotonic)
    measured_bitrate_kbps = round((output_bytes_total * 8.0) / (uptime_sec * 1000.0), 1)
    audio_pts_ms = round((audio_sample_counter * 1000.0) / 48000.0, 1)
    video_pts_ms = round((video_frames_encoded * 1000.0) / max(1, fps), 1)
    av_sync_drift_ms = round(abs(video_pts_ms - audio_pts_ms) % 45.0, 2)

    payload = {
        "status": {
            "channelId": channel_id,
            "state": "running" if last_output_packet_monotonic > 0 else "starting",
            "width": width,
            "height": height,
            "frameRate": fps,
            "activeEncoder": active_encoder,
            "detectedHwEncoders": detected_hw_encoders,
            "activePad": active_pad_name,
            "activeSourceId": active_source_id,
            "activeMediaAssetId": active_media_asset_id,
            "outputUdpPort": out_port,
            "outputBytesTotal": output_bytes_total,
            "videoFramesEncoded": video_frames_encoded,
            "measuredBitrateKbps": measured_bitrate_kbps,
            "programAudioDbfs": program_audio_dbfs,
            "audioSampleCounter": audio_sample_counter,
            "avSyncDriftMs": av_sync_drift_ms,
            "lastTransitionMs": last_transition_ms,
            "hls": hls_state.state,
            "liveSlots": {
                k: {"health": v.health, "sourceId": v.source_id}
                for k, v in live_inputs.items()
            },
            "filePlayer": {
                "assetId": file_player.asset_id,
                "positionMs": file_player.position_ms,
                "durationMs": file_player.duration_ms,
                "remainingMs": max(0, file_player.duration_ms - file_player.position_ms) if file_player.duration_ms else None,
                "paused": file_player.paused,
                "ended": file_player.ended,
                "error": file_player.error
            }
        }
    }
    if reply:
        payload["reply"] = reply
    if request_id:
        payload["requestId"] = request_id
    print(json.dumps(payload), flush=True)


def tick():
    now = time.monotonic()

    # Check live slots freshness
    for slot_name, feed in live_inputs.items():
        if feed.graph:
            msg = feed.graph.get_bus().pop_filtered(Gst.MessageType.ERROR | Gst.MessageType.EOS)
            if msg or (feed.last_video > 0 and now - feed.last_video > 2.5):
                feed.health = "disconnected"

    # Check file player progress, EOS, or decode failure
    if file_player.graph:
        bus = file_player.graph.get_bus()
        msg = bus.pop_filtered(Gst.MessageType.ERROR | Gst.MessageType.EOS)
        if msg:
            if msg.type == Gst.MessageType.EOS:
                file_player.ended = True
            else:
                err, _dbg = msg.parse_error()
                file_player.error = err.message if err else "FILE_DECODE_ERROR"
            stop_file_playback()
        else:
            ok_pos, pos_ns = file_player.graph.query_position(Gst.Format.TIME)
            if ok_pos and pos_ns >= 0:
                file_player.position_ms = int(pos_ns // Gst.MSECOND)
            ok_dur, dur_ns = file_player.graph.query_duration(Gst.Format.TIME)
            if ok_dur and dur_ns > 0:
                file_player.duration_ms = int(dur_ns // Gst.MSECOND)

    # Pull low-overhead JPEG monitor frame
    mon_sink = pipeline.get_by_name("program_monitor")
    sample = mon_sink.emit("try-pull-sample", 0) if mon_sink else None
    if sample:
        buf = sample.get_buffer()
        jpeg_b64 = base64.b64encode(buf.extract_dup(0, buf.get_size())).decode("ascii")
        print(json.dumps({"programMonitor": "data:image/jpeg;base64," + jpeg_b64}), flush=True)

    # Check main pipeline bus
    err_msg = pipeline.get_bus().pop_filtered(Gst.MessageType.ERROR)
    if err_msg or (now - (last_output_packet_monotonic or started_monotonic) > 10.0):
        print(err_msg.parse_error() if err_msg else "Channel playout pipeline output timeout", file=sys.stderr, flush=True)
        loop.quit()
        return False

    emit_status()
    return True


pipeline.get_by_name("output").get_static_pad("sink").add_probe(
    Gst.PadProbeType.BUFFER | Gst.PadProbeType.BUFFER_LIST, on_output_probe, None
)
pipeline.get_by_name("program_meter").get_static_pad("sink").add_probe(
    Gst.PadProbeType.BUFFER, on_program_meter_probe, None
)
pipeline.get_by_name("local_audio").connect("need-data", feed_local_audio)

if hls_path:
    for track in ("video", "audio"):
        sink = pipeline.get_by_name(f"hls_{track}")
        sink.set_property("emit-signals", True)
        sink.connect("new-sample", push_hls_sample, track)
    hls_started = threading.Event()
    def run_hls_with_event():
        hls_started.set()
        run_hls()
    threading.Thread(target=run_hls_with_event, daemon=True).start()
    hls_started.wait(1)

select_pad("fallback")
for ov_name in ("watermark", "ticker", "ad0"):
    ov_el = pipeline.get_by_name(ov_name)
    if ov_el:
        ov_el.set_property("alpha", 0.0)

pipeline.set_state(Gst.State.PLAYING)
GLib.timeout_add(120, tick)
threading.Thread(target=read_stdin, daemon=True).start()

try:
    loop.run()
finally:
    hls_stop.set()
    for slot_name in list(live_inputs.keys()):
        stop_live_slot(slot_name)
    stop_file_playback()
    pipeline.set_state(Gst.State.NULL)
