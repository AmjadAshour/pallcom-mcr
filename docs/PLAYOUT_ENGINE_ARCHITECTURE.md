# Phase Six Server-Side Multi-Channel Playout Engine Architecture

## 1. Control Plane vs. Execution Plane Separation

Phase Six separates the management control plane from the broadcast execution plane:

- **Control Plane (Express API & React Management Console)**:
  - Persists desired channel state (`desiredState`: `STOPPED` | `RUNNING`), configuration revisions (`revision`), camera rotation sequences (`cameraSequence`), movie queues (`movieQueue`), advertisement policies (`adSchedulePolicy`), fallback hierarchies (`fallbackConfig`), and authorized camera network allowlists (`networkAllowlist`) through `IChannelPlayoutRepository` ([sqlite-channel-playout-repository.js](../backend/src/infrastructure/repositories/sqlite-channel-playout-repository.js) and `PrismaChannelPlayoutRepository` in [prisma-repositories.js](../backend/src/infrastructure/repositories/prisma-repositories.js)).
- **Supervision Plane (`MultiChannelPlayoutSupervisor` & `ChannelPlayoutInstance`)**:
  - Implemented in [channel-playout-supervisor.js](../backend/src/infrastructure/playout/channel-playout-supervisor.js).
  - Maintains an isolated `ChannelPlayoutInstance` per `${organizationId}:${channelId}`, enforces resource admission controls (`assertResourceAdmission`), serializes lifecycle mutations (`start`, `stop`, `restart`), coordinates camera rotation and movie queue progression, pumps independent Phase Five 48 kHz PCM audio into the worker, persists bounded runtime checkpoints every 2.5 seconds, and supervises worker crashes with bounded exponential backoff.
- **Broadcast Execution Plane (`channel-worker.py` GStreamer Pipeline)**:
  - Implemented in [channel-worker.py](../backend/src/infrastructure/playout/channel-worker.py).
  - Runs as a dedicated OS process per active channel (`1920×1080` Full HD I420 video @ configurable `25 fps` + `48,000 Hz` Stereo `S16LE` / `AAC-LC` audio).
  - Operates completely independently of the operator's browser, React UI, administrative login session, or OBS connection when OBS is not the active input.

---

## 2. Full HD 1920×1080 Normalization, Hardware Acceleration Detection & Monotonic Clocks

1. **Full HD Normalization Pipeline**:
   - All live inputs (`live1`, `live2`) and file inputs (`file` via `uridecodebin`) pass through `videoconvert ! videoscale ! videorate ! video/x-raw,format=I420,width=1920,height=1080,framerate=25/1,pixel-aspect-ratio=1/1` before reaching `input-selector name=v`.
   - Audio inputs are resampled to `audio/x-raw,format=S16LE,layout=interleaved,rate=48000,channels=2` and timestamped from a single monotonic sample counter (`audio_sample_counter`, advancing by `960` samples / `20 ms` per frame).
2. **Hardware Encoder Detection with Safe Software Fallback**:
   - At worker startup, `channel-worker.py` queries `Gst.ElementFactory.find()` for `nvh264enc`, `vaapih264enc`, and `qsvh264enc` and reports `detectedHwEncoders` in its status telemetry.
   - By default (`hwAccelMode: 'AUTO_WITH_SW_FALLBACK'`), the worker uses a controlled zero-latency `x264enc` profile (`tune=zerolatency speed-preset=veryfast bitrate=4500 key-int-max=25 bframes=0`) so hardware driver failures never silently overload or crash the broadcast pipeline.
3. **Zero-Encoder-Restart Switching**:
   - `input-selector name=v` switches between `sink_0` (fallback slate), `sink_1` (`live1`), `sink_2` (`live2`), and `sink_3` (`file`) downstream into the single `x264enc` and `mpegtsmux` instance.
   - Rotating cameras, transitioning from an intro to an advertisement to a 2+ hour movie, or activating fallback never restarts `x264enc` or `mpegtsmux` and never resets `audio_sample_counter`.

---

## 3. Channel One — Automatic Live Camera Rotation & Controlled VPN Allowlist

- **Dual-Slot Alternation (`live1` / `live2`)**:
  - `ChannelPlayoutInstance._stepCameraRotation()` alternates camera feeds across `live1` and `live2` in `channel-worker.py`, recording measured switch latency (`transitionMs`) in `transitionHistory`.
- **Configurable Dwell, Manual Override, Exclusion & Skip**:
  - Each camera entry in `cameraSequence` defines `sourceId`, `name`, `uri` or `udpPort`, `durationSeconds`, and `enabled`.
  - Operators can trigger immediate manual camera switches (`POST /playout/camera/switch`) or temporarily exclude/include a camera (`POST /playout/camera/exclude`). Unavailable or excluded cameras are skipped automatically; if all cameras become unavailable, the channel transitions to `FALLBACK_ACTIVE` (`_activateFallback`) and automatically recovers to `RUNNING` when a camera returns.
- **Controlled Camera Network & VPN Allowlist (`validateCameraDestinationWithAllowlist`)**:
  - Preserves all Phase One SSRF and DNS-rebinding defenses: `localhost`, `127.0.0.0/8`, `0.0.0.0`, and cloud metadata (`169.254.0.0/16`) are unconditionally blocked even if added to an allowlist.
  - Private camera VLAN/WireGuard destinations (e.g., `10.88.10.25:8443`) are denied by default (`400`) unless their exact `host` and `port` are explicitly authorized in the channel's `networkAllowlist`.

---

## 4. Channel Two — Continuous Movie Playout, Safe Seeking & Ad Insertion

- **Streaming Disk Playback (`uridecodebin`)**:
  - Full-length movies (verified with a **2-hour-and-5-minute / `7,500.021`-second** `1920×1080` MP4) stream directly from `<MCR_MEDIA_STORAGE_ROOT>/media` via GStreamer `uridecodebin` with bounded queues (`max-size-buffers=8` video, `max-size-buffers=24` audio). Entire movie files are never loaded into Node.js or Python RAM.
- **Sequential Queue Progression, Missing/Corrupted File Recovery & Safe Seeking**:
  - `_startMovieAtIndex()` verifies each queued asset's `READY` status, symlink safety, and physical file presence before instructing `channel-worker.py` to decode it. Missing or corrupted files are skipped and logged in `recoveryHistory`, falling back to `FALLBACK_ACTIVE` only if every item in the queue fails.
  - Supports instant keyframe seeking (`POST /playout/movie/seek` via `Gst.SeekFlags.FLUSH | Gst.SeekFlags.KEY_UNIT`, verified at the `+3,600,000 ms` / 1-hour mark of a 2h05m movie), pause/resume (`POST /playout/movie/pause`), and inter-movie advertisement break insertion (`_playAdvertisementBreak`) that automatically restores the movie queue upon completion.
