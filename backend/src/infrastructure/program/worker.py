"""Single-station MPEG-TS worker. The Node supervisor owns stdin."""
import json
import base64
import sys
import threading
import time

import gi
gi.require_version("Gst", "1.0")
gi.require_version("GdkPixbuf", "2.0")
from gi.repository import GLib, Gst, GdkPixbuf

Gst.init(None)
in_port, out_port = map(int, sys.argv[1:3])
slate = {"black": "black", "bars": "smpte100", "blue": "blue"}[sys.argv[3]]
initial = json.loads(sys.stdin.readline())
width, height = initial["canvas"]["width"], initial["canvas"]["height"]
video = f"video/x-raw,format=I420,width={width},height={height},framerate=25/1,pixel-aspect-ratio=1/1"
audio = "audio/x-raw,format=S16LE,layout=interleaved,rate=48000,channels=2"
pipeline = Gst.parse_launch(
    f"videotestsrc is-live=true pattern={slate} ! {video} ! v.sink_0 "
    f"intervideosrc channel=obs ! {video} ! v.sink_1 "
    "input-selector name=v ! tee name=picture "
    "picture. ! queue leaky=downstream max-size-buffers=1 ! videorate drop-only=true ! videoscale ! "
    "video/x-raw,width=320,height=180,framerate=1/1 ! jpegenc ! appsink name=preview max-buffers=1 drop=true sync=false async=false "
    "picture. ! queue ! "
    + "".join(f"gdkpixbufoverlay name=ad{i} alpha=0 positioning-mode=pixels-absolute ! " for i in range(4))
    + "gdkpixbufoverlay name=watermark ! x264enc tune=zerolatency speed-preset=veryfast "
    "bitrate=2500 key-int-max=25 bframes=0 ! h264parse config-interval=-1 ! queue ! mux. "
    f"audiotestsrc is-live=true wave=silence ! {audio} ! a.sink_0 "
    f"interaudiosrc channel=obs ! {audio} ! a.sink_1 "
    "input-selector name=a ! audioconvert ! avenc_aac ! aacparse ! queue ! mux. "
    f"mpegtsmux name=mux alignment=7 ! udpsink name=output host=127.0.0.1 port={out_port} sync=false async=false"
)
loop = GLib.MainLoop()
source = "fallback"
health = "disconnected"
last = {}
healthy_since = None
previous = None
started = time.monotonic()
last_packet = 0
ingest = None
retry_at = 0
watermark_revision = 0
ads_revision = 0
visible_ads = []
ad_ready = [False] * 4


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
    status = dict(state="running" if last_packet else "starting", source=source, obs=health,
                  watermarkRevision=watermark_revision, adsRevision=ads_revision, visibleAds=visible_ads)
    if reply or status != previous:
        print(json.dumps(dict(status=status, reply=reply)), flush=True)
        previous = status


def select(name):
    global source
    for selector in ("v", "a"):
        element = pipeline.get_by_name(selector)
        element.set_property("active-pad", element.get_static_pad("sink_1" if name == "obs" else "sink_0"))
    source = name


def command(line):
    action = line.strip()
    if action.startswith("{"):
        packet = json.loads(action)
        if "adLayers" in packet:
            apply_ads(packet)
            print('{"adsReceived":true}', flush=True)
        else:
            apply_watermark(packet)
        report()
    elif action == "stop":
        loop.quit()
    elif action in ("obs", "fallback"):
        if action == "obs" and health != "ready":
            report("unavailable")
        else:
            select(action)
            report("applied")
    return False


def read_commands():
    for line in sys.stdin:
        GLib.idle_add(command, line)
    GLib.idle_add(loop.quit)


def arrived(pad, info, kind):
    global last_packet
    if kind == "output":
        last_packet = time.monotonic()
    else:
        last[kind] = time.monotonic()
    return Gst.PadProbeReturn.OK


def watch(graph, element, kind):
    types = Gst.PadProbeType.BUFFER | Gst.PadProbeType.BUFFER_LIST
    graph.get_by_name(element).get_static_pad("sink").add_probe(types, arrived, kind)


def open_input():
    graph = Gst.parse_launch(
        f'udpsrc address=127.0.0.1 port={in_port} reuse=false caps="video/mpegts,systemstream=true,packetsize=188" ! '
        'tsdemux latency=80 name=d '
        f'd. ! video/x-h264 ! queue ! h264parse ! avdec_h264 ! videoconvert ! videoscale ! videorate ! {video} ! '
        'intervideosink name=picture channel=obs sync=false async=false '
        f'd. ! audio/mpeg,mpegversion=4 ! queue ! aacparse ! avdec_aac ! audioconvert ! audioresample ! {audio} ! '
        'interaudiosink name=sound channel=obs sync=false async=false'
    )
    watch(graph, "picture", "video")
    watch(graph, "sound", "audio")
    graph.set_state(Gst.State.PLAYING)
    return graph


def tick():
    global ingest, retry_at, health, healthy_since
    now = time.monotonic()
    sample = pipeline.get_by_name("preview").emit("try-pull-sample", 0)
    if sample:
        buf = sample.get_buffer()
        jpeg = base64.b64encode(buf.extract_dup(0, buf.get_size())).decode("ascii")
        print(json.dumps({"preview": "data:image/jpeg;base64," + jpeg}), flush=True)
    error = pipeline.get_bus().pop_filtered(Gst.MessageType.ERROR)
    if error or now - (last_packet or started) > 8:
        print(error.parse_error() if error else "Program mux stopped producing packets", file=sys.stderr)
        loop.quit()
        return False
    if ingest is None and now >= retry_at:
        try:
            ingest = open_input()
        except GLib.Error as error:
            print(f"Contribution decoder unavailable: {error.message}", file=sys.stderr)
            retry_at = now + 5
    failed = ingest and ingest.get_bus().pop_filtered(Gst.MessageType.ERROR | Gst.MessageType.EOS)
    fresh = all(now - last.get(kind, -100) < 1 for kind in ("audio", "video"))
    if failed or not fresh:
        healthy_since = None
        health = "disconnected"
        if source == "obs":
            select("fallback")
        if ingest and (failed or (last and now - min(last.values()) >= 1)):
            ingest.set_state(Gst.State.NULL)
            ingest = None
            last.clear()
            retry_at = now + 0.2
    else:
        if healthy_since is None:
            healthy_since = now
        health = "ready" if now - healthy_since >= 5 else "warming"
    report()
    return True


watch(pipeline, "output", "output")
select("fallback")
apply_watermark(initial)
pipeline.set_state(Gst.State.PLAYING)
GLib.timeout_add(80, tick)
threading.Thread(target=read_commands, daemon=True).start()
try:
    loop.run()
finally:
    if ingest:
        ingest.set_state(Gst.State.NULL)
    pipeline.set_state(Gst.State.NULL)
