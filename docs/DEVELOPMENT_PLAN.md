# Development plan

Phase Zero established this plan. [MASTER_REQUIREMENTS.md](../MASTER_REQUIREMENTS.md) is the permanent specification. The [current tracker](TASKS.md#current-master-specification-tracker) governs phase entry, dependencies, acceptance and verification. The earlier roadmap records historical work.

## Phase Zero architecture and workflow audit

| Area | Current working-tree evidence | Disposition |
| --- | --- | --- |
| React operator UI | Route-split dashboard, stations, live, multiview, audio, sources, graphics, scheduler, automation, audit logs, users and settings. A public browser-overlay route is separate. API access uses the shared fetch wrapper and visibility-aware polling. | Preserve bilingual routing and native workflows. Defer final navigation and styling to Phase 18. |
| Express, permissions and realtime | JSON routes, schema validation, role guards, repository-backed tenant checks, cookie-backed sessions, rate limiting, scoped Socket.IO and Agent WebSocket. | Consolidate policy and negative-test coverage before expanding source or media capabilities. |
| OBS path | Authenticated Agent dials the server and owns OBS WebSocket v5 control, snapshots, stream/record/replay and local media scanning. OBS playout, macro and schedule workflows are still in use as compatibility paths. | Preserve the Agent boundary and current endpoints until actual equivalents are verified. No live OBS command was sent in this phase. |
| Native video and audio | Node supervisor launches a Python/GStreamer worker. FFmpeg prepares media. Native Program runs one selected station per runtime, with local scenes, playback, dual inputs, switch/fallback, audio mixing and monitoring. | Keep separate control and media planes. Replace the process singleton only behind an enforceable worker lease and recovery tests. |
| IPTV and destinations | MPEG-TS UDP and optional SRT, worker-packaged authenticated or signed HLS, optional separate FFmpeg/Nginx public IPTV path. Available URL depends on deployment and session. | Keep existing endpoint compatibility. Separate authorization modes, measure playback churn, plan stable channel URL and secure token handling. |
| Graphics and ads | Native watermark, ticker and scheduled ad placements coexist with legacy browser-overlay APIs. The old OBS editor is absent from the primary graphics page in the working tree. | Keep established on-air overlays and public link contracts until individually migrated. |
| Database and media | The factory returns SQLite repositories. Program, sessions and schedules also access SQLite directly. Prisma declares MySQL and has a schema and seed path, but it is not the current runtime persistence implementation. Prepared video, frames and PCM are SQLite data. | Establish MySQL repository contracts without changing production data. Store new large media as file/object references and rehearse migration on a sanitized copy. |
| Build and deployment | npm workspaces for React, Express, Agent, Electron and shared packages. Vite proxies local API/realtime traffic. Render and Compose have separate configuration. Compose includes an opt-in IPTV packager. | Preserve existing entry points. Verify both deployment modes and media tool availability in staging before rollout. |

Route and service boundaries are recorded in [API_DOCUMENTATION.md](API_DOCUMENTATION.md). Baseline evidence is in [TEST_REPORT.md](TEST_REPORT.md). Security findings are in [SECURITY.md](SECURITY.md).

## Exact upload limit

The native Program scene upload is capped at **128 MiB (134,217,728 bytes)** and **60 seconds**. The shared constant in `backend/packages/shared/src/index.js` drives the browser size check in `frontend/src/context/programVideo.js`. The Express route checks the supplied Content-Length and returns HTTP 413. The streaming copy in `backend/src/infrastructure/program/ad-creatives.js` counts actual bytes and enforces the cap even without Content-Length. The nested Nginx location also applies `client_max_body_size 128m` with request buffering disabled. Production ingress limits outside the repository were not measured.

Increasing the proxy threshold alone leaves the app's caps and architecture intact. Prepared clips have a separate 64 MiB cap, the route serializes preparation per process and caps the library at 32 files per station, and preparation reads derived media into memory before writing SQLite. The migration must use durable upload sessions, bounded chunk streaming to file/object storage, integrity checks, quotas and worker-side preparation. Treat the short-scene and ad pipelines as separate compatibility workflows.

Phase Three implements the centralized filesystem-backed Media Library and resumable chunked upload system (`/api/v1/media/*` and `/media` in React) alongside the retained 128 MiB/60s legacy scene compatibility route. Full-length movies and multi-gigabyte files stream directly to `<MCR_MEDIA_STORAGE_ROOT>/uploads` in bounded chunks (up to 64 MiB per chunk, default 20 GiB max file size and 8-hour max duration), undergo magic-byte and asynchronous FFprobe/FFmpeg validation (`backend/src/infrastructure/media/media-processor.js`), and are promoted to `<MCR_MEDIA_STORAGE_ROOT>/media` without storing video BLOBs in SQLite or MySQL. See [MEDIA_LIBRARY_ARCHITECTURE.md](MEDIA_LIBRARY_ARCHITECTURE.md).

## Capacity model and deployment constraints

The current Program video profile is 1280×720 at 25 fps with roughly 2.5 Mb/s configured video bitrate plus audio and transport overhead. For planning, a measured output of 3 Mb/s consumes approximately 1.35 GB per hour per continuous recording or transfer. Multiply by channels and independent long-running destinations. Direct HLS egress grows with concurrent viewers unless a delivery/cache tier is introduced. Allocate additional headroom for upload staging, simultaneous transcodes, backups, files retained by policy, and filesystem and protocol overhead.

CPU and RAM minima cannot be inferred from this repository. Benchmark ingest decode, software encode, normalization, overlays, scheduler load and concurrent uploads separately, then together. Measure peak RSS, CPU, disk latency and free space, sender/receiver throughput, A/V drift, and loss or restart recovery against representative codec and source profiles. Document the chosen hardware and network, capture steady-state and peak results, and agree on admission and storage limits before release. The present loopback fixtures establish functionality, not production capacity.

## Backup and rollback procedure

Before a future approved change, record the Git revision and working-tree diff, identify the running release and output, and verify a protected SQLite snapshot using the repository recovery tools. Preserve media, recording references, approved configuration, and secrets separately with restricted access. Never copy or overwrite the active database as a migration strategy. Restore to a new location and verify integrity, station ownership, schedule counts and representative media references. Test a prior application version against a compatible restored copy and measure receiver recovery. Repoint production only after explicit approval. For MySQL, add a dedicated forward migration, verified restores, and an owner-approved cutover and rollback window. No production backup, state change or migration was performed in Phase Zero.

## Recommended order and decision gates

1. Phase 01, reduce credential, API, media URL, worker and deployment risks.
2. Phase 02, account lifecycle and permissions. Use the Phase Zero MySQL interface plan in Phases 02–07, with persistence contract decisions for each approved feature matching Phase 15. Never silently start Phase 15 implementation. If an approved phase requires a MySQL capability that is unavailable, record it as BLOCKED and obtain an explicit scope/order decision.
3. Phases 03–06, storage, unified sources, audio, durable playout. Keep output decoding observable during each transition.
4. Phases 07–14, scheduling, timeline, live control, recovery, IPTV, graphics, EPG and monitoring, ordered by dependencies in the tracker.
5. Phase 15, verify and rehearse the complete MySQL architecture and any separately authorized migration. Phase 16 verifies the integrated functionality before any final design work.
6. Phase 17, request a visual reference after Phase 16. Present the design analysis, information architecture and implementation plan, then stop. Require explicit approval before Phase 18. Then proceed through performance and final acceptance, one separately approved phase at a time.

Open decisions for later phases include the authorized staging endpoints and MySQL instance, the intended IPTV audiences, target channel and viewer load, continuity and recovery targets, and test media rights. These are prerequisites to the respective verification gates, not blockers to the Phase Zero source audit.

## Phase One status

Phase One remains open. The [Phase One evidence](PHASE_ONE_GATES.md) records the completed local controls, redacted source and history scans, and offline encryption rotation rehearsal. Actual credential rotation requires an approved maintenance window and recovery plan. Effective TLS, log handling, egress, host quotas and least-privilege validation require an authorized staging target. Outstanding Phase One acceptance requirements remain in the tracker. Phase Two requires its own approval after Phase One acceptance.

The isolated Windows staging fixture verified application TLS, an HTTP and WebSocket reverse proxy, Chromium CSP and secure sessions, and the real Agent against an authenticated OBS protocol simulator. Real OBS needs host or VM network isolation. MySQL application integration remains unavailable because the active repositories and session and Program services depend on SQLite. [Local staging procedure and limits](DEPLOYMENT.md#phase-one-local-staging)

The owner explicitly approved starting Phase Two locally with synthetic SQLite data and generated keys while Phase One is open. This approval leaves staging, production credential rotation and deployment gated. Any Phase Two feature requiring active MySQL repositories still needs the separate Phase 15 scope decision.
## Proposed post-audit execution order

Phase Two is approved for local account work. Phase One operational gates remain open. The following sequence is the proposed production roadmap. Preserve the original phase IDs and evidence. The original Phase 15 retains full parity, migration and cutover acceptance. Other future implementation requires separate approval.

| Order and original IDs | Depends on | Acceptance, security and verification |
| --- | --- | --- |
| 1. Phase 01 hardening | 00 | Isolated regressions and authorized release evidence for secrets, ACLs, authorization, proxies, inputs, dependencies and HLS. Review each open security gate. |
| 2. Phase 01 staging closure | Local controls | Reproducible isolated Linux deployment, actual proxy/TLS/CSP and authorized OBS, firewall, log and least-privilege validation. Capture a receiver baseline. |
| 3. Phase 15 foundation | 01 accepted and order approved | Implement async contracts, isolated MySQL, transactional sessions/ownership and migrations. Run concurrency, tenant and restoration fixtures. |
| 4. Phase 02 accounts | MySQL foundation | Verify account lifecycle, MFA/recovery, permission matrix, session expiry and audit transactions. |
| 5. Phases 06 and 09 multi-channel foundation | 02 and persistence | Prove dynamic channel creation, resource admission, worker fencing, channel isolation and control restart with independent receivers. |
| 6. Phase 03 large media | Persistence and channels | Resumable bounded ingestion, quotas, integrity and durable private assets. Test concurrent interrupted uploads during output. |
| 7. Phase 04 cameras | Workers and storage | Qualify RTSP/RTMP/HLS/SRT sources, scoped egress and rotation/fallback. Measure switch recovery and reject unauthorized sources on the staged network. |
| 8. Phase 05 audio | Channel workers and sources | Prove independent music, radio and microphone modes, access checks, mixing and uninterrupted decoded audio during video switching. |
| 9. Phases 06, 09 and 10 continuous engine | Media, cameras and audio | Prove persistent output, operator control, fault isolation, takeover, fallback and recovery within receiver budgets. |
| 10. Phases 07 and 08 scheduling | Continuous engine and media | Verify versioned timelines, recurrence, automatic next item, ads and deletion restrictions with receiver and as-run records. |
| 11. Phases 11 and 13 delivery and EPG | Engine, schedules and accounts | Prove protected permanent per-channel HLS/MPEG-TS, provider revocation and accurate escaped EPG data. Test negative authorization and endpoint/clock stability. |
| 12. Phases 12 and 14 graphics, ads and monitoring | Schedules and distribution | Verify decoded logo, ticker, ads, role-scoped telemetry, retention, log redaction and alerts under injected faults. |
| 13. Phase 16 integrated dual HD | Phases 02–14 and 15 parity | Test concurrent Full HD on actual staging with receivers. Record security, continuity and compatibility findings. Verify MySQL, media and provider parity. |
| 14. Phase 15 cutover rehearsal and deployment track of 19/20 | Integrated evidence | Restore to clean Linux, verify updates and rollback while preserving identities, data and scopes. Production cutover/deployment each requires authorization. |
| 15. Phase 17 design gate | 16 verified | Obtain new owner-provided visual reference and explicit proposal approval. |
| 16. Phase 18 approved interface reconstruction | 17 | Verify bilingual/accessibility/role flows. Remove legacy functionality only after confirming disuse and passing regression. |
| 17. Phases 19 and 20 final acceptance | All functional and design gates | Qualify 72-hour run, resources, receiver/recovery budgets and security release. Require owner go/no-go. |

Implementation details are in [MySQL migration](MYSQL_MIGRATION_PLAN.md), [channel architecture](MULTI_CHANNEL_ARCHITECTURE.md), [Linux deployment](DEPLOYMENT_PLAN.md), [updates](UPDATE_AND_ROLLBACK_PLAN.md) and [broadcast acceptance](BROADCAST_ACCEPTANCE_PLAN.md).
