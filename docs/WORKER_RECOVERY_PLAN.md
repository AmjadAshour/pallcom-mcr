# Worker Supervision, Fault Isolation, and Automatic Recovery Plan

## 1. Failure Classification

Phase Six distinguishes source-level faults from worker-level faults so a broken camera or media file never terminates the channel's broadcast encoder:

| Fault Level | Trigger | Recovery Action | Impact on Channel Encoder |
| --- | --- | --- | --- |
| **Single Camera Failure / Exclusion** | Camera stream timeout (`> 2.5s`), probe error, or operator exclusion | `_stepCameraRotation()` immediately skips to the next healthy camera in `cameraSequence` | **Zero encoder restart** (`input-selector` pad switch only) |
| **All Cameras Unavailable** | Every camera in `cameraSequence` is offline or excluded | `_activateFallback()` switches `input-selector` to `FALLBACK_ACTIVE` (configured fallback video or black slate) and polls every `2,000 ms` until a camera recovers | **Zero encoder restart**; independent audio continues uninterrupted |
| **Missing or Corrupted Movie File** | Asset missing on disk, symlink rejected, or GStreamer decode error | `_startMovieAtIndex()` logs `SKIPPED_MISSING_MOVIE_FILE` / `SKIPPED_CORRUPTED_MOVIE_FILE` and advances immediately to the next valid movie in `movieQueue` | **Zero encoder restart** |
| **Primary Audio Source Loss** | Primary music or radio stream drops below `silenceThresholdDbfs` or fails probe | `ChannelAudioEngine.stepFrame()` automatically enables `FALLBACK_AUDIO` (`880 Hz` / backup track) and restores primary audio upon recovery | **Zero encoder restart** |
| **Transient Database Checkpoint Failure** | Temporary DB lock or connection hiccup during the 2.5s checkpoint timer | Caught and ignored in `checkpointTimer`; worker process continues emitting MPEG-TS/HLS packets | **Zero broadcast interruption** |
| **Unexpected GStreamer Worker Process Termination** | `channel-worker.py` exits unexpectedly (`SIGKILL`, crash, or 10s output watchdog timeout) while `desiredState === 'RUNNING'` | `_handleUnexpectedWorkerExit()` transitions channel to `RECOVERING`, increments `restartCount`, applies bounded exponential backoff (`500 ms`–`8,000 ms`), and respawns `channel-worker.py` from the last persisted checkpoint | Only the affected channel worker respawns; **all other channels continue with 0 restarts** |

---

## 2. Crash-Loop Prevention and Process Cleanup

1. **Sliding-Window Crash-Loop Circuit Breaker**:
   - Each `ChannelPlayoutInstance` tracks `crashCountInWindow` within a 60-second window.
   - If a worker crashes more than `5` times within 60 seconds, the supervisor halts automatic restarts, sets `runtimeState = 'FAILED'`, records the diagnostic reason in `lastError`, and waits for operator intervention.
2. **Orphan Process & Temporary HLS Directory Cleanup**:
   - On intentional `stop()`, `restart()`, or worker exit, `ChannelPlayoutInstance` sends `stop\n` to `stdin`, arms a 3-second `SIGKILL` watchdog timer, clears all rotation/audio/checkpoint timers, and deletes the temporary HLS segment directory (`cleanHlsDirectory`).
   - Inside `channel-worker.py`, the `finally:` block stops the HLS thread, sets all live and file sub-graphs to `Gst.State.NULL`, and sets the main pipeline to `Gst.State.NULL`.

---

## 3. Measured Recovery Evidence

In [two-channel-playout-acceptance.js](../backend/verification/two-channel-playout-acceptance.js):

- Channel One and Channel Two were started simultaneously at `1920×1080 @ 25 fps`.
- Channel One's GStreamer worker process was forcibly terminated with `SIGKILL`.
- **Measured Outcome**:
  - Channel One detected the process exit immediately, entered `RECOVERING`, incremented `restartCount` to `1`, spawned a new worker PID, and resumed `RUNNING` state in **`~2.1` seconds** (including the `1,000 ms` initial backoff and GStreamer pipeline preroll).
  - Channel Two experienced **`0` restarts** and continued decoding `1920×1080` video and `48 kHz` stereo audio throughout Channel One's crash and recovery.
