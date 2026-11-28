# Phase Five Independent Audio Sources and Multi-Track Broadcast Mixer Architecture

## 1. Overview and Server-Side Broadcast Guarantee

Phase Five implements a genuine server-side multi-channel audio processing and mixing architecture (`48,000 Hz`, 16-bit signed stereo PCM `S16LE` internally, muxed as `48 kHz` stereo `AAC-LC` into the broadcast MPEG-TS and HLS outputs). All broadcast audio decoding, level metering, per-source gain/attenuation, priority-based automatic ducking, equal-power crossfading, soft-knee peak limiting, silence detection, automatic fallback takeover, and GStreamer Program worker injection run on the server ([audio-mixer-engine.js](../backend/src/infrastructure/audio/audio-mixer-engine.js) and [worker.py](../backend/src/infrastructure/program/worker.py)) — never in a browser tab.

Closing or refreshing the operator browser tab never interrupts broadcast audio.

---

## 2. Multi-Channel Isolation

- Every broadcast channel (`channelId` / `stationId`) within an organization (`organizationId`) is managed by an isolated `ChannelAudioEngine` instance keyed by `${organizationId}:${channelId}` inside `MultiChannelAudioManager`.
- Channel 1 (`Channel One Master Control`), Channel 2 (`Channel Two`), and any dynamically provisioned future channels maintain separate source buffers, separate ducking envelopes, separate microphone sessions, separate persisted `AudioMixerConfig` rows, and separate `AudioSource` catalogs.
- Changes to Channel 1 audio sources, faders, mutes, solos, routing modes, or microphone sessions have zero effect on Channel 2.

---

## 3. Supported Audio Source Types (All 11 Types)

| Source Type | Description | Validation & Ingestion |
| --- | --- | --- |
| `UPLOADED_AUDIO` | Uploaded music or audio recording from the Phase Three Media Library | Requires a `READY` `MediaAsset` with `hasAudio: true`; decoded to 48 kHz stereo `s16le` PCM via FFmpeg |
| `MUSIC_PLAYLIST` | Ordered or shuffled sequence of audio assets from `media_playlists` | Validates playlist tracks, supports `NONE`, `REPEAT_PLAYLIST`, `REPEAT_TRACK`, shuffle, and equal-power track crossfading (`crossfadePcmBuffers`) |
| `INTERNET_RADIO` | External HTTP/HTTPS live radio stream | Enforces public IPv4 DNS/SSRF validation (`validateRadioStreamUrl`), probes codec/ICY metadata via `ffprobe`, encrypts optional credentials via AES-256-GCM |
| `ICECAST_STREAM` | Icecast live audio relay stream | Validated, probed, and reconnected with bounded exponential backoff |
| `SHOUTCAST_STREAM` | Shoutcast live audio relay stream | Validated, probed, and reconnected with bounded exponential backoff |
| `MICROPHONE_INPUT` | Live operator voiceover / commentary input | Starts in `PAUSED` state; requires explicit authenticated `audio:manage` activation (`POST /microphone`), binds to `userId` + `sessionId` + JWT expiration, and revokes immediately on session expiry or permission loss |
| `VIDEO_EXTRACTED_AUDIO` | Embedded audio track from an active video source | Linked to a `VideoSource` (`videoSourceId`); can be muted independently (`cameraAudioMuted: true`) while keeping video on air |
| `OBS_AUDIO_INPUT` | Named OBS Studio audio bus/input | Scoped to the station Agent (`obsInputName`) and reflects Agent online readiness |
| `ADVERTISEMENT_AUDIO` | Dedicated commercial / promotional break audio | Governed by the channel's `adAudioPolicy` (`REPLACE_MUSIC_PAUSE_PLAYLIST`, `REPLACE_MUSIC_CONTINUE_PLAYLIST`, `DUCK_MUSIC_DURING_ADS`, `IGNORE_AD_AUDIO`) |
| `FALLBACK_AUDIO` | Emergency backup audio track | Automatically activates when primary music/radio sources drop below `silenceThresholdDbfs` or enter `ERROR`/`RECONNECTING` |
| `GENERATED_SILENCE` | Clean digital zero-PCM generator (`-90 dBFS`) | Generates exact 20 ms (`3,840`-byte) zero-filled stereo frames |

---

## 4. Audio Routing Modes and Independent Audio Across Video Switches

Each channel supports 6 routing modes (`AUDIO_ROUTING_MODES`):

1. `ORIGINAL_VIDEO_AUDIO_ONLY`: Uses only the embedded audio from the active video source.
2. `EXTERNAL_REPLACES_VIDEO_AUDIO`: Mutes embedded video/camera audio and replaces it completely with the independent external audio mix (`workerMode = 'replace'`).
3. `MIX_VIDEO_AND_EXTERNAL_AUDIO`: Mixes embedded video audio with independent external music/radio/mic tracks (`workerMode = 'mix'`).
4. `MIX_MULTIPLE_EXTERNAL_SOURCES`: Mixes multiple simultaneous external audio sources (e.g., background music + radio + live commentary).
5. `SILENT_VIDEO_WITH_INDEPENDENT_AUDIO`: Forces `cameraAudioMuted: true` so silent or muted camera feeds rotate freely while independent music or radio plays continuously (`workerMode = 'replace'`).
6. `MICROPHONE_COMMENTARY_OVER_PROGRAM`: Enables live operator commentary over the Program mix with automatic priority ducking of lower-priority tracks.

### Zero-Interruption Video Switching Bridge (`worker.py` & `supervisor.js`)

In [worker.py](../backend/src/infrastructure/program/worker.py), the GStreamer broadcast pipeline maintains a single monotonic 48 kHz sample counter (`audio_sample`) feeding `appsrc name=local_audio` in 20 ms (`960`-sample / `3,840`-byte) increments. When `ChannelAudioEngine.stepFrame()` runs, it calls `pushExternalAudioFrame(channelId, broadcastMix.pcmBuffer, workerMode)` in [supervisor.js](../backend/src/infrastructure/program/supervisor.js), which writes `{ externalAudioFrame, mode }` to the GStreamer worker's `external_audio_pcm` ring buffer (`deque(maxlen=16)`). Switching video pads (`obs` -> `obs2` -> `scene` -> `fallback`) in GStreamer never resets `audio_sample` and never restarts the encoder session.

---

## 5. DSP Mixing Pipeline (`mixPcmFrameDsp`)

For every 20 ms frame (`960` stereo samples = `3,840` bytes at `48,000 Hz`):

1. **Per-Source Metering**: Computes true RMS and Peak levels in `dBFS` (`measurePcmFrame`: $20 \log_{10}(\text{amplitude})$ clamped to $[-90, +6]\text{ dBFS}$).
2. **Monitoring-Only Solo (`soloMonitoring`)**:
   - The engine computes two parallel mix buses per step:
     - `broadcastMix` (`monitoringSoloOnly: false`): Ignores `soloMonitoring` flags so toggling Solo in the control room **never** mutes non-soloed tracks on the live broadcast output.
     - `monitorMix` (`monitoringSoloOnly: true`): When one or more active sources have `soloMonitoring: true`, isolates only the soloed sources for the operator's headphone/monitoring bus.
3. **Priority-Based Automatic Audio Ducking**:
   - Sources with `duckingTrigger: true` (or active `MICROPHONE_INPUT` / `ADVERTISEMENT_AUDIO`) whose measured RMS exceeds `duckingThresholdDbfs` (default `-32 dBFS`) trigger attenuation of lower-priority sources marked `duckingTarget: true`.
   - The ducking envelope smoothly transitions toward `duckingReductionDb` (default `-12 dB` to `-14 dB`) over `duckingAttackMs`, holds for `duckingHoldMs`, and smoothly recovers over `duckingReleaseMs` without clicks or pops.
4. **Equal-Power Crossfading (`crossfadePcmBuffers`)**:
   - Uses $\cos(\frac{\pi}{2} t)$ and $\sin(\frac{\pi}{2} t)$ weights across the overlap window (`crossfadeDurationMs`, default `1500 ms`) to maintain constant perceived loudness without clipping during track transitions.
5. **Master Gain & Soft-Knee Peak Limiter**:
   - Applies `masterVolumeLinear`, `masterGainDb`, and `masterMuted`, then passes every sample through a soft-knee saturation limiter bounded strictly by `peakLimiterCeilingDbfs` (default `-1.0 dBFS`), setting `clippingPrevented: true` whenever limiting engages.
