# Feature matrix

Target capabilities follow the [public MCR Box feature inventory](https://mcrbox.com/). PARTIAL records repository evidence with gaps. None of these full capability rows has on-air acceptance evidence.

| # | Capability | Status | Repository evidence | Remaining acceptance |
| --- | --- | --- | --- | --- |
| 1 | Ingest / decode | PARTIAL | OBS owns configured live scenes; no independent input pipeline | Real local sample, SRT/RTMP/UDP/RTP/RTSP/HLS fixtures and capture compatibility |
| 2 | Remote guests | MISSING | No guest WebRTC workflow found | Invitation, waiting room, TURN and authenticated return feed |
| 3 | PTZ | MISSING | No ONVIF/VISCA control surface found | Compatible cameras and preset/control tests |
| 4 | Remote commentary | MISSING | No remote commentary worker found | WebRTC channels, mix-minus and audio return tests |
| 5 | File playout | PARTIAL | Scheduler, OBS deck adapter, direct MP4 upload to scenes and a Video input with preview and direct Take. Station managers can assign the single SQLite-backed Program engine from Live Control | Long-form playout, real OBS interoperability, in/out, seek, timing and DST |
| 6 | Live switching | PARTIAL | LiveControlPage and OBS v5 scene commands | Actual Program output, keying and frame timing |
| 7 | Graphics | PARTIAL | Graphics page with Independent Program ads, watermark and encoded news ticker, plus OBS graphics and text sources | Templates, scoreboards and isolated third-party graphics |
| 8 | Replay | PARTIAL | OBS replay buffer start/stop/save controls and OBS save-event timestamp | OBS staging verification, clip playback, marks, variable speed and export |
| 9 | Audio mixing | PARTIAL | Independent Program mixer for two network inputs and station-scoped operator listening to the final mix. Local decoders verified simultaneous tones, attenuation, mute and source loss. Chrome played the audio monitor. | Delay, EQ, compression and long-run synchronization |
| 10 | Loudness | MISSING | OBS channel levels are available | LUFS, true peak and independent reference measurements |
| 11 | AI directing | MISSING | No tracking model found | Representative footage, evaluation and operator override |
| 12 | Format conversion | MISSING | Media probe reads metadata | Worker conversion and independent A/V validation |
| 13 | Encode / transcode | MISSING | OBS may encode its configured outputs | Worker codec/ABR/GPU tests and capacity results |
| 14 | Captions | MISSING | No timed multilingual caption pipeline found | Caption import, output and timing fixtures |
| 15 | SCTE-35 | MISSING | No cue processing found | Independent analyzer verification |
| 16 | Watermark | PARTIAL | Visible station logo supported | Licensed forensic watermark provider and detection evidence |
| 17 | IP routing | PARTIAL | Independent Program fans out MPEG-TS over local UDP and two optional SRT callers. Independent receivers verified loss isolation. An optional destination probe reported decoded audio and video, loss and recovery on encrypted loopback SRT. | External receiver and HTTPS telemetry qualification, other delivery protocols and throughput benchmarks |
| 18 | HLS / DASH origin | PARTIAL | Optional station-authorized single-rendition HLS from Independent Program, with bounded segments, plus opt-in Linux Compose IPTV packaging. FFmpeg decoded local HLS and UDP together. | Linux container playback, ABR, DASH, production HTTPS and throughput |
| 19 | DVB multiplexer | MISSING | No MPEG-TS multiplex worker found | PID/SI/PSI continuity and independent DVB tests |
| 20 | Conditional access | MISSING | No CAS integration found | Licensed vendor, secure key workflow and validation |
| 21 | Multiview | PARTIAL | OBS snapshots, sortable tiles, fullscreen, bitrate and per-input peak levels. Independent Live Control displays two input previews and the Program picture, meters, and on-demand audio. | Live OBS verification, measured latency and large station layouts |
| 22 | TS analyzer | PARTIAL | Offline header and PID continuity scan detected injected packet loss in a captured HLS MPEG-TS segment. | PCR, PSI validation and TR 101 290 coverage |
| 23 | Recording | PARTIAL | OBS recording controls and scheduled jobs | Retention, quotas, downloads and recovery evidence |
| 24 | Fleet / redundancy | PARTIAL | Station-scoped pairing, credential rotation/revocation and liveness telemetry | Independent workers, leases, redundancy and measured recovery |

Phase 2 staging evidence extends rows 1, 6 and 12. One opt-in worker decodes a localhost H.264/AAC MPEG-TS input, switches to/from a generated slate, and encodes an independent 720p25 Program. A separate receiver confirmed real OBS signal loss and manual return. Production and broader protocol qualification remain open. [Evidence](INDEPENDENT_PROGRAM_STAGING.md)

Row 7 also includes a global, persisted watermark on the independent encoder. Its Preview/Apply workflow, proportional layout and source-independent stacking have local 720p receiver evidence. [Watermark operating procedure](INDEPENDENT_PROGRAM_STAGING.md)

Independent Program advertising extends row 7 with a station creative library, scheduled image/video playlists, four composited placements and manual controls. Local receiver evidence covers position, size, stacking, motion, fades, gaps and rotation. [Operating and acceptance details](INDEPENDENT_PROGRAM_STAGING.md)

## Master specification baseline

See [Phase Zero test evidence](TEST_REPORT.md) for current isolated checks of the MP4 upload, ticker, authenticated and signed HLS, and simulated OBS acknowledgement. Historical capability statuses do not establish production readiness or approval of a master-specification phase. Exact upload limits and the proposed persistence architecture are in the [development plan](DEVELOPMENT_PLAN.md).

## Post-audit production target

The protected application HLS path remains available. The previous static Compose distribution path is denied. A stable provider gateway, two simultaneous 1080p channels, dynamic channel provisioning, multi-gigabyte movie workflows, continuous direct camera rotation and independent audio continuity are target capabilities awaiting implementation and receiver proof. [Production acceptance](BROADCAST_ACCEPTANCE_PLAN.md)
