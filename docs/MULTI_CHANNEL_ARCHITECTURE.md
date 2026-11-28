# Multi-channel architecture proposal

The current Independent Program selects one station per runtime. Propose one supervised worker and bounded hot standby resources per authorized channel, with channel-scoped queues, media directories, secrets, output state and leases. A web/API restart leaves workers emitting media. The control plane uses MySQL for durable desired state and commands. Workers use authenticated requests, monotonic revisions, idempotency keys and a fencing generation so an obsolete worker cannot publish.

Keep each channel encoder and distribution output separate from source sessions. Channel One prewarms the next approved camera within a resource budget and switches normalized video at a frame boundary. Independent audio continues on its own clock and enters the final mux separately. Expiring health probes, hysteresis, cooldowns and deterministic fallbacks keep camera churn bounded. Channel Two pre-probes, prepares and pins media and validated ads against the published timeline. Recovery derives the next correct item from time and durable as-run records.

Put contributions behind protocol-specific admission and network boundaries. Resolve and enforce approved destinations at connection time, including any URL references a manifest uses. Separate private camera networks from management, metadata and database services. Bound probing, retries, concurrency, bitrate, file expansion and disk. Avoid operator-controlled process flags. Add channels dynamically through RBAC-controlled creation and capacity reservation. Reject allocation if encoder, disk, egress or recovery headroom would fall below acceptance budgets.

Use a stable opaque channel identity at the delivery gateway. Grant each provider scoped rights and independent credentials. Check each manifest and segment against the provider grant. Map stable paths to channel-owned rolling output, with monotonic media sequences, explicit discontinuities and measured receiver behavior. Give each MPEG-TS distribution transport an approved encrypted or explicitly isolated network profile. Keep consumer backpressure isolated from the encoder.

## Phase Six Multi-Channel Implementation & Linux/Docker Requirements

Phase Six implements the multi-channel execution architecture in [channel-playout-supervisor.js](../backend/src/infrastructure/playout/channel-playout-supervisor.js) and [channel-worker.py](../backend/src/infrastructure/playout/channel-worker.py):

1. **Dynamic Per-Channel Isolation**:
   - Every station/channel created through the management API gets an isolated `ChannelPlayoutInstance` (`${organizationId}:${channelId}`), an isolated `ChannelAudioEngine`, a dedicated OS worker process (`channel-worker.py`) with process-unique intervideo channels (`ch_<pid>_live1`, `ch_<pid>_live2`, `ch_<pid>_file`), a dedicated UDP output port (`outputUdpPort`), an isolated temporary HLS packaging directory (`mcr-ch-<id>-hls-*`), and an independent `ChannelPlayoutConfig` row in SQLite/MySQL.
   - Resource admission controls (`assertResourceAdmission`) enforce `MCR_MAX_CONCURRENT_CHANNELS` (default `4`) and `MCR_MIN_FREE_MEMORY_MB` (default `256 MB`), returning HTTP `503` rather than allowing new channel workers to exhaust host memory.
2. **Ubuntu Server LTS & Docker Compose Runtime Dependencies**:
   - **GStreamer 1.0 packages**: `gstreamer1.0-tools`, `gstreamer1.0-plugins-base`, `gstreamer1.0-plugins-good`, `gstreamer1.0-plugins-bad` (`hlssink2`, `mpegtsmux`, `tsdemux`, `srtsink`, `intervideosrc`/`intervideosink`), `gstreamer1.0-plugins-ugly` (`x264enc`, `lamemp3enc`), `gstreamer1.0-libav` (`avdec_h264`, `avdec_aac`, `avenc_aac`), `python3-gi`, `gir1.2-gst-plugins-base-1.0`, `gir1.2-gdkpixbuf-2.0`.
   - **FFmpeg / FFprobe**: `ffmpeg` and `ffprobe` (`>= 6.0`, verified on `8.1.2`) with `libx264`, `aac`, `libmp3lame`, `mpegts`, and `hls`.
   - **Headless Operation**: Neither `channel-worker.py` nor `worker.py` depends on X11, Wayland, or physical ALSA/PulseAudio sound cards.
   - See [PLAYOUT_ENGINE_ARCHITECTURE.md](PLAYOUT_ENGINE_ARCHITECTURE.md), [WORKER_RECOVERY_PLAN.md](WORKER_RECOVERY_PLAN.md), and [PERFORMANCE_BENCHMARKS.md](PERFORMANCE_BENCHMARKS.md).
