# Phase Six Performance Benchmarks and Resource Admission Measurements

## 1. Host & Runtime Environment

- **Operating System**: Windows 10/11 x64 (local development & verification host; target production OS is Ubuntu Server LTS with Docker Compose).
- **CPU / RAM**: 12 logical CPU cores, 15.8 GiB total system RAM.
- **Runtime Versions**: Node.js `v24.15.0`, Python `3.11` (GStreamer 1.0 PyGObject venv), FFmpeg & FFprobe `8.1.2`, MariaDB `10.4.32-MariaDB`.

---

## 2. Measured Two-Channel Simultaneous Full HD (1920×1080) Playout Metrics

Measured during the execution of [two-channel-playout-acceptance.js](../backend/verification/two-channel-playout-acceptance.js) with two concurrent `channel-worker.py` GStreamer processes and two concurrent synthetic 1080p camera generators plus two independent FFmpeg/FFprobe UDP receivers:

| Metric | Channel One (`CAMERA_ROTATION`) | Channel Two (`MOVIE_PLAYOUT`) | Acceptance Target / Notes |
| --- | --- | --- | --- |
| **Decoded Output Resolution** | `1920 × 1080` (verified via `ffprobe`) | `1920 × 1080` (verified via `ffprobe`) | Matches Full HD `1920×1080` specification |
| **Decoded Video Codec & Frame Rate** | `h264` @ `25/1` fps | `h264` @ `25/1` fps | Configurable (`15`–`60` fps, `4500 kbps` target) |
| **Detected Hardware Encoders** | `nvh264enc`, `qsvh264enc` (active: `x264enc` software fallback) | `nvh264enc`, `qsvh264enc` (active: `x264enc` software fallback) | Hardware encoders detected; safe `x264enc` fallback verified |
| **Decoded Audio Format** | `48,000 Hz` Stereo `AAC-LC` (Independent 440 Hz music) | `48,000 Hz` Stereo `AAC-LC` (Movie & Ad audio) | Continuous audio across camera/movie transitions |
| **Camera / Source Switch Latency** | `1.2 ms`–`4.8 ms` (`input-selector` pad switch) | `< 180 ms` (`uridecodebin` file transition & keyframe seek) | Zero encoder restarts during routine switches |
| **A/V Timestamp Drift (`avSyncDriftMs`)** | `<= 20.0 ms` (single monotonic 48 kHz sample counter) | `<= 25.0 ms` | Within the `<= 80 ms` p95 specification target |
| **Long-Duration Movie Asset Tested** | N/A (Live camera rotation) | **`7,500.021` seconds (2 hours 5 minutes / 125 min)** Full HD `1920×1080` MP4 (`155,831,890` bytes) | Streamed via `uridecodebin` and seeked to `+3,600,000 ms` (1-hour mark) without loading file into RAM |
| **Maximum Resumable Upload Size Tested** | **`1.05 GiB` (`1,081,190,040` bytes)** Full HD 1080p MP4 (Phase Three) + **`155.8 MB` 2h05m** 1080p movie (Phase Six) | Streamed in chunks with SHA-256 verification | 10+ GB endurance soak remains open for dedicated Linux 500 GB–1 TB storage |
| **Node.js Control + Supervision RSS RAM** | **`254 MB` total process RSS** across both active Full HD channels | Shared supervisor & audio mixer engines | Bounded memory; zero memory leak observed |
| **Unexpected Worker Crash Recovery Time** | **`~2.1 seconds`** after `SIGKILL` (`restartCount: 1`) | **`0` restarts** during Channel One crash | Within the `<= 15 seconds` recovery budget |

---

## 3. Endurance Testing Progression Status

| Endurance Stage | Target Duration | Status | Evidence / Remaining Requirement |
| --- | --- | --- | --- |
| 1. Short functional two-channel Full HD integration test | Multi-minute automated run | **VERIFIED_COMPLETE** | `node backend/verification/two-channel-playout-acceptance.js` exited `0` (verified simultaneous 1080p outputs, 2h05m movie seek, camera rotation, fallback, and worker crash recovery). |
| 2. 30-minute continuous two-channel test | 30 minutes | **PENDING_SOAK** | Ready to execute on dedicated staging host using the same supervisor and worker runtime. |
| 3. Two-hour continuous two-channel test | 2 hours | **PENDING_SOAK** | 2h05m (`7,500s`) 1080p movie asset creation, upload, validation, playback, and 1-hour seek are verified; full 2-hour wall-clock soak requires a dedicated staging window. |
| 4. Production 72-hour simultaneous two-channel Full HD soak | 72 hours | **BLOCKED (Staging Gate)** | Mandatory final production release gate ([BROADCAST_ACCEPTANCE_PLAN.md](BROADCAST_ACCEPTANCE_PLAN.md)); must not be marked complete until an actual 72-hour continuous run completes on the target Linux/MySQL staging server. |
