# Feature matrix

Target capabilities follow the [public MCR Box feature inventory](https://mcrbox.com/). PARTIAL records repository evidence with gaps. None of these full capability rows has on-air acceptance evidence.

| # | Capability | Status | Repository evidence | Remaining acceptance |
| --- | --- | --- | --- | --- |
| 1 | Ingest / decode | PARTIAL | OBS owns configured live scenes; no independent input pipeline | Real local sample, SRT/RTMP/UDP/RTP/RTSP/HLS fixtures and capture compatibility |
| 2 | Remote guests | MISSING | No guest WebRTC workflow found | Invitation, waiting room, TURN and authenticated return feed |
| 3 | PTZ | MISSING | No ONVIF/VISCA control surface found | Compatible cameras and preset/control tests |
| 4 | Remote commentary | MISSING | No remote commentary worker found | WebRTC channels, mix-minus and audio return tests |
| 5 | File playout | PARTIAL | Scheduler, OBS deck adapter, direct MP4 upload to scenes and a Video input with preview and direct Take | Long-form playout, real OBS interoperability, in/out, seek, timing and DST |
| 6 | Live switching | PARTIAL | LiveControlPage and OBS v5 scene commands | Actual Program output, keying and frame timing |
| 7 | Graphics | PARTIAL | Graphics page with Independent Program ads, watermark and encoded news ticker, plus OBS graphics and text sources. OBS forms show actions as they become available, and OBS setup opens on demand. | Templates, scoreboards and isolated third-party graphics |
| 8 | Replay | PARTIAL | OBS replay buffer start/stop/save controls and OBS save-event timestamp | OBS staging verification, clip playback, marks, variable speed and export |
| 9 | Audio mixing | PARTIAL | AudioMixerPage and OBS input controls | Delay, EQ, compression, routing and track verification |
| 10 | Loudness | MISSING | OBS channel levels are available | LUFS, true peak and independent reference measurements |
| 11 | AI directing | MISSING | No tracking model found | Representative footage, evaluation and operator override |
| 12 | Format conversion | MISSING | Media probe reads metadata | Worker conversion and independent A/V validation |
| 13 | Encode / transcode | MISSING | OBS may encode its configured outputs | Worker codec/ABR/GPU tests and capacity results |
| 14 | Captions | MISSING | No timed multilingual caption pipeline found | Caption import, output and timing fixtures |
| 15 | SCTE-35 | MISSING | No cue processing found | Independent analyzer verification |
| 16 | Watermark | PARTIAL | Visible station logo supported | Licensed forensic watermark provider and detection evidence |
| 17 | IP routing | MISSING | Station Agent RPC is a control tunnel | Media fan-out and protocol conversion benchmarks |
| 18 | HLS / DASH origin | PARTIAL | Opt-in Linux Compose configuration packages one Program into HTTPS HLS with FFmpeg and Nginx | Linux container build, independent playback, ABR, signed links and DASH |
| 19 | DVB multiplexer | MISSING | No MPEG-TS multiplex worker found | PID/SI/PSI continuity and independent DVB tests |
| 20 | Conditional access | MISSING | No CAS integration found | Licensed vendor, secure key workflow and validation |
| 21 | Multiview | PARTIAL | OBS and Independent Program snapshots, Program/Preview, sortable tiles, fullscreen, measured OBS bitrate and per-input peak levels | Live OBS verification, measured latency and independent encoded multiview |
| 22 | TS analyzer | MISSING | No TR 101 290 component found | Independent analyzer and known-good/fault TS fixtures |
| 23 | Recording | PARTIAL | OBS recording controls and scheduled jobs | Retention, quotas, downloads and recovery evidence |
| 24 | Fleet / redundancy | PARTIAL | Station-scoped pairing, credential rotation/revocation and liveness telemetry | Independent workers, leases, redundancy and measured recovery |

Phase 2 staging evidence extends rows 1, 6 and 12. One opt-in worker decodes a localhost H.264/AAC MPEG-TS input, switches to/from a generated slate, and encodes an independent 720p25 Program. A separate receiver confirmed real OBS signal loss and manual return. Production and broader protocol qualification remain open. [Evidence](INDEPENDENT_PROGRAM_STAGING.md)

Row 7 also includes a global, persisted watermark on the independent encoder. Its Preview/Apply workflow, proportional layout and source-independent stacking have local 720p receiver evidence. [Watermark operating procedure](INDEPENDENT_PROGRAM_STAGING.md)

Independent Program advertising extends row 7 with a station creative library, scheduled image/video playlists, four composited placements and manual controls. Local receiver evidence covers position, size, stacking, motion, fades, gaps and rotation. [Operating and acceptance details](INDEPENDENT_PROGRAM_STAGING.md)
