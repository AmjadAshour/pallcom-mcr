"""Run on an SRT destination host and report recently decoded Program tracks."""
import json
import os
import re
import threading
import time
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener

import gi
gi.require_version("Gst", "1.0")
from gi.repository import Gst


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


listen_url = os.environ.get("MCR_SRT_RECEIVER_URL", "")
report_url = os.environ.get("MCR_SRT_RECEIVER_REPORT_URL", "")
token = os.environ.get("MCR_SRT_RECEIVER_TOKEN", "")
try:
    endpoint = urlsplit(report_url)
    listener = urlsplit(listen_url)
    report_port = endpoint.port
    local_http = endpoint.scheme == "http" and endpoint.hostname in ("127.0.0.1", "::1")
    valid = (
        (endpoint.scheme == "https" or local_http)
        and endpoint.hostname and not endpoint.username and not endpoint.password
        and (report_port is None or report_port > 0)
        and not endpoint.query and not endpoint.fragment
        and listener.scheme == "srt" and listener.port
        and parse_qs(listener.query).get("mode") == ["listener"]
        and re.fullmatch(r"[a-f0-9]{64}", token)
    )
except ValueError:
    valid = False
if not valid:
    raise SystemExit("Set a listener URI, an HTTPS (or loopback HTTP) report endpoint and a 64-character hex token.")

Gst.init(None)
pipeline = Gst.parse_launch(
    "srtsrc name=source ! tsdemux name=transport "
    "transport. ! queue ! h264parse ! avdec_h264 ! "
    "fakesink name=video signal-handoffs=true sync=false async=false "
    "transport. ! queue ! aacparse ! avdec_aac ! "
    "fakesink name=audio signal-handoffs=true sync=false async=false"
)
pipeline.get_by_name("source").set_property("uri", listen_url)
last_sample = {}


def sample(_sink, _buffer, _pad, track):
    last_sample[track] = time.monotonic()


def report(stop):
    http = build_opener(ProxyHandler({}), NoRedirect())
    previous_error = False
    while not stop.is_set():
        now = time.monotonic()
        body = json.dumps({track: now - last_sample.get(track, float("-inf")) < 3
                           for track in ("video", "audio")}).encode()
        request = Request(report_url, body, {
            "Authorization": f"Bearer {token}", "Content-Type": "application/json",
        })
        try:
            with http.open(request, timeout=2):
                pass
            previous_error = False
        except (HTTPError, URLError, OSError) as error:
            expected = isinstance(error, HTTPError) and error.code == 409
            if isinstance(error, HTTPError):
                error.close()
            if not expected and not previous_error:
                print("Receiver health report unavailable. Check endpoint and token.", flush=True)
            previous_error = not expected
        stop.wait(2)


for track in ("video", "audio"):
    pipeline.get_by_name(track).connect("handoff", sample, track)

stop = threading.Event()
reporter = threading.Thread(target=report, args=(stop,), daemon=True)
reporter.start()
try:
    bus = pipeline.get_bus()
    while True:
        if pipeline.set_state(Gst.State.PLAYING) != Gst.StateChangeReturn.FAILURE:
            while not bus.timed_pop_filtered(500 * Gst.MSECOND, Gst.MessageType.ERROR | Gst.MessageType.EOS):
                pass
        pipeline.set_state(Gst.State.NULL)
        last_sample.clear()
        time.sleep(1)
except KeyboardInterrupt:
    pass
finally:
    stop.set()
    pipeline.set_state(Gst.State.NULL)
    reporter.join(timeout=3)
