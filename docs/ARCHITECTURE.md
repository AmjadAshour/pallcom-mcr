# Target architecture

Keep the current Node/React control plane. Add an isolated media plane behind a typed worker adapter once the worker identity and lifecycle contract is testable. Prefer GStreamer for dynamic pipelines and FFmpeg/ffprobe for suitable conversion and metadata operations. Negotiate capabilities with measurements before showing hardware acceleration as available.

Keep SQLite for existing single-node deployments. Evaluate MySQL 8.4 only when multi-node persistence requirements justify migration and equivalent backup/restore, transactions and isolation tests pass. Store large assets in files or object storage. See [ADR 0001](decisions/0001-control-media-boundary.md).

## Master specification planning decision

The current [master specification](../MASTER_REQUIREMENTS.md) requires MySQL for persistent relational storage. The existing SQLite deployment described above remains the verified baseline. The target is a typed Express-to-worker interface, durable channel state and leases, MySQL metadata and file/object-backed media. Define adapter and migration contracts before enabling new persistence-dependent features. A production cutover requires an independently restored rehearsal, integrity comparison and owner approval. [Phase Zero architecture and capacity audit](DEVELOPMENT_PLAN.md)

## Production architecture revision proposal

Production targets Linux and MySQL with two simultaneous 1080p channels. The current program runtime still has a single selected station and SQLite persistence. The proposed control/worker split uses per-channel ownership, independent encoders, fenced workers and stable provider-facing channel identities. Keep dedicated persistent media and metadata references separate. See [multi-channel architecture](MULTI_CHANNEL_ARCHITECTURE.md), [MySQL migration](MYSQL_MIGRATION_PLAN.md), [Linux deployment](DEPLOYMENT_PLAN.md), [Phase Three media storage and resumable upload architecture](MEDIA_LIBRARY_ARCHITECTURE.md), [Phase Five independent audio and multi-track mixer architecture](AUDIO_ARCHITECTURE.md), [Phase Six server-side playout engine architecture](PLAYOUT_ENGINE_ARCHITECTURE.md), [worker recovery plan](WORKER_RECOVERY_PLAN.md) and [performance benchmarks](PERFORMANCE_BENCHMARKS.md).


## Phase Seven - Broadcast Scheduler (2026-11-28)
Implemented and verified locally (SQLite, local MariaDB 10.4.32 only; Oracle MySQL 8.4 gate G48 remains open). Evidence: `backend/test/broadcast-scheduler.test.js` (5 tests: DST, recurrence, validation, RBAC/draft/publish/concurrency/delete-protection, simulated 72-hour schedule), `backend/verification/two-channel-scheduler-acceptance.js` (two real 1920x1080@25 GStreamer channels, FFprobe/FFmpeg receivers, mid-movie ad resume at 5899 ms, camera failure/recovery, manual override, draft isolation, cross-channel isolation), `backend/verification/mysql-migration-rehearsal.js` (scheduler tables parity), full workspace suite 52/52 passing, frontend build passing.
Not claimed: a real 72-hour wall-clock endurance run (open production gate); the 72-hour test is validation plus a deterministic clock simulation. Manual override currently sets state flags and pauses scheduled starts; it does not switch the live source itself. Production security gates remain open. Phase Eight not started.
