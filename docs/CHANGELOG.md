# Changelog

## Unreleased

- Added the platform audit, roadmap, 24-module inventory and engineering acceptance process.
- Added Agent transport liveness, OBS telemetry expiry, bounded command backlog and validated telemetry/events. Station list and detail use consistent runtime connection status.
- Added per-station Agent credential rotation, revocation, expiry handling and an audit trail for credential changes.

### Master specification and Phase Zero

Saved the permanent requirements and recorded the current architecture, security findings, verified baseline and phased acceptance tracker. Phase Zero makes documentation changes only. Subsequent phases require explicit owner approval.

## 2026-11-27 — Phase One post-audit work

- End Program audio monitoring at access-token expiry and recheck session and resource eligibility while streaming.
- Protect Windows Agent credential files with DPAPI and restrict Linux credential paths.
- Deny static Compose IPTV and retain authorized playlist/segment delivery in the application.
- Expire new graphics links, support explicit revocation, and limit token-bearing proxy logs.
- Require explicit private UDP contribution opt-in and add sanitized worker and receiver exit diagnostics.
- Adopt the two-channel Linux/MySQL production requirements and publish a proposed dependency order with the original approval gates.

## 2026-11-28 — Phases Two through Five and Phase 15 MySQL Foundation

- **Phase Two (Authentication & Accounts)**: Added self-service profile and Argon2id password change, session listing/revocation, optional TOTP MFA with single-use recovery codes, loopback password recovery, administrator password reauthentication on user creation, inactive-account `LOGIN_FAILED` audit logging, and 14 granular non-viewer permission gates.
- **Phase Three (Media Library & Large Uploads)**: Added filesystem-backed Media Library across 12 categories, resumable multi-GB chunked uploads (verified at 1.05 GiB across a mid-upload backend restart and 180s Full HD 1080p video during active broadcast), magic-byte + FFprobe/FFmpeg validation and quarantine, controlled server-directory and SSRF-protected URL imports, video/audio playlists, and reference-locked deletion.
- **Phase 15 MySQL Foundation & Phase Four (Unified Video Sources)**: Added Prisma MySQL repositories, version-controlled SQL migration (`20261128_0001_phase15_and_phase05_foundation`), non-destructive SQLite-to-MySQL migration script and local MariaDB/MySQL rehearsal, and the 10-type unified video source catalog with SSRF/DRM defenses, AES-256-GCM encrypted secrets, FFprobe health probing, exponential retry backoff, and automatic fallback.
- **Phase Five (Independent Audio Sources & Multi-Track Mixer)**: Added per-channel isolated 48 kHz stereo PCM audio engines supporting all 11 audio source types and 6 routing modes, per-source volume/dB gain/mute, monitoring-only solo vs broadcast mix isolation, priority-based automatic ducking with attack/hold/release envelope, equal-power crossfading, soft-knee peak limiting, advertisement audio policies, radio stream probing/reconnection/fallback, explicit session-bound microphone activation, GStreamer `worker.py` external PCM injection across video switches, and the Channel One broadcast acceptance test.
- **Phase Six (Server-Side Multi-Channel Playout Engine)**: Added per-channel Full HD (`1920x1080`) GStreamer playout workers (`channel-worker.py`) and supervisor (`channel-playout-supervisor.js`), Channel 1 automatic live camera rotation with controlled VPN allowlists and independent audio continuity, Channel 2 continuous movie playout verified with a 2-hour-and-5-minute (`7,500.021s`) Full HD 1080p MP4 movie, inter-movie ad breaks, 1-hour keyframe seek, active-broadcast media deletion locks, crash-loop-protected worker recovery, version-controlled SQL migration (`20261128_0002_phase06_channel_playout_engine`), and the `ChannelPlayoutConsole` React UI.


## Phase Seven - Broadcast Scheduler (2026-11-28)
Implemented and verified locally (SQLite, local MariaDB 10.4.32 only; Oracle MySQL 8.4 gate G48 remains open). Evidence: `backend/test/broadcast-scheduler.test.js` (5 tests: DST, recurrence, validation, RBAC/draft/publish/concurrency/delete-protection, simulated 72-hour schedule), `backend/verification/two-channel-scheduler-acceptance.js` (two real 1920x1080@25 GStreamer channels, FFprobe/FFmpeg receivers, mid-movie ad resume at 5899 ms, camera failure/recovery, manual override, draft isolation, cross-channel isolation), `backend/verification/mysql-migration-rehearsal.js` (scheduler tables parity), full workspace suite 52/52 passing, frontend build passing.
Not claimed: a real 72-hour wall-clock endurance run (open production gate); the 72-hour test is validation plus a deterministic clock simulation. Manual override currently sets state flags and pauses scheduled starts; it does not switch the live source itself. Production security gates remain open. Phase Eight not started.
