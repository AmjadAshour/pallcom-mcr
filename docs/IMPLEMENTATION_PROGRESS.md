# Implementation progress

2026-11-24. Phase 00 baseline and the initial phases 01–02 control-plane slice. All 20 pre-change tests passed against a temporary SQLite path. Existing README and Windows Agent worktree edits were noted before work. The development slice changes only the server Agent gateway, station status, tests and planning documents. No deployment was performed.

The post-change suite passed 21 tests on Node.js 22. GATES:G1 passed simulated heartbeat loss, telemetry expiry/recovery, validation, and command backlog handling. GATES:G2 passed the authenticated Agent tunnel, cross-tenant checks, OBS acknowledgement simulation, and playout regressions. GATES:G3 records the manual documentation comparison.

The first-slice security review found that Agent command result schemas, credential rotation/revocation, enrollment and MFA still need follow-up. No actual OBS output or broadcast continuity was measured. See the [task register](TASKS.md) and [acceptance gates](../GATES.md).

## Continuation — P0-003A

Added scoped credential generations and revocation, old-socket disconnection, expiry, atomic pairing-code invalidation and audit logging. Legacy credentials continue until each station is rotated. Added the Settings action and updated the operational instructions.

`npm test` passed 21 tests using temporary SQLite. `npm run build:web` and `npm run build:server` passed. `npm audit --package-lock-only --omit=dev` reported zero known findings. Both [credential acceptance gates](AGENT_CREDENTIAL_GATES.md) passed. No real broadcast, production rollout, or hardware acceptance test was performed.

Next P0 task: split MFA enrollment/recovery from audit tamper resistance and start with MFA for privileged users. Keep Agent command-result schemas and a longer enrollment token tracked before enabling independent network-facing workers.

## Monitoring and replay controls — Modules 21 and 08

Multiview displays averaged OBS stream bitrate from output byte and duration deltas and sampled peak dBFS per named OBS input. A reconnect, a stopped stream, or invalid counters clear the measured bitrate. Stale meter samples are omitted. Operators can start, stop, or save the configured OBS replay buffer through station-scoped, audited commands. OBS save events update the last-save timestamp without exposing a local file path.

These controls require an updated station Agent. OBS must have Replay Buffer enabled in its Output settings. Clip playback, advanced replay editing, and a separate encoding worker remain pending. No live output settings were changed.

## Operator-facing slice — Module 21

Multiview now presents sortable station tiles, responsive column presets, Program and Preview snapshots, and fullscreen. Preferences are scoped to the dashboard user and organization in browser storage. The existing station-scoped snapshot endpoints remain the media source, with no new broadcast commands.

`npm run build:web` passed. Local Chrome with synthetic station responses confirmed drag-and-drop, bus selection, preference persistence and fullscreen. Actual OBS output, measurement of capture latency, larger deployments, audio meters and independent encoded multiview remain unverified or unimplemented. Rollback is limited to the Multiview page and these documentation updates.

## Independent Program initiative — Phase 1 audit

The [implementation specification](INDEPENDENT_PROGRAM_SPEC.md) traces current signals, proposes service and timing contracts, and defines receiver acceptance gates. Four existing simulated playout and bitrate tests passed locally. Deployment identity and actual Program output remain unverified. Rollback consists of removing the specification and this progress entry.

## Independent Program initiative — Phase 2

A single opt-in station can start and stop a separate GStreamer worker and select a loopback OBS contribution. A real portable OBS sender and an independent receiver exercised loss, fallback and manual return. A separate Chrome run captured output after closing the operator tab. See the [staging instructions, evidence and rollback](INDEPENDENT_PROGRAM_STAGING.md).

## Independent Program initiative — Phase 4 watermark

Implemented against the Phase 2 worker and its 720p output profile. A clean image sampled before the watermark supplies the editor Preview. A revision-checked apply stores the station settings and emits the final overlay after source selection. The local receiver fixture checked a 2:1 uploaded image, inset, opacity, source changes, signal-loss fallback, disabling and restart. The Chrome check exercised pending edits and explicit apply. See the [staging runbook](INDEPENDENT_PROGRAM_STAGING.md) for reproduction and rollback.

## Independent Program initiative — Phase 5 advertising

Added a station-scoped image/video library, four independent placement playlists and revision-checked Preview/Apply and live controls. The broadcast scheduler persists timing and override state in SQLite. Receiver testing exposed a one-frame overlap glitch at a lower placement's gap; keeping each placement in a stable layer fixed it. Clock tests cover scheduled eligibility, rotation, simultaneous starts, overrides, restart and DST. The local 720p25 receiver measured a 90-frame cycle (3.6 seconds), decoded the short video repeating, and confirmed the upper placement stayed visible. See the [staging procedure and rollback](INDEPENDENT_PROGRAM_STAGING.md).
