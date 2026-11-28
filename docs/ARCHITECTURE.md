# Target architecture

Keep the current Node/React control plane. Add an isolated media plane behind a typed worker adapter once the worker identity and lifecycle contract is testable. Prefer GStreamer for dynamic pipelines and FFmpeg/ffprobe for suitable conversion and metadata operations. Negotiate capabilities with measurements before showing hardware acceleration as available.

Keep SQLite for existing single-node deployments. Evaluate MySQL 8.4 only when multi-node persistence requirements justify migration and equivalent backup/restore, transactions and isolation tests pass. Store large assets in files or object storage. See [ADR 0001](decisions/0001-control-media-boundary.md).

## Master specification planning decision

The current [master specification](../MASTER_REQUIREMENTS.md) requires MySQL for persistent relational storage. The existing SQLite deployment described above remains the verified baseline. The target is a typed Express-to-worker interface, durable channel state and leases, MySQL metadata and file/object-backed media. Define adapter and migration contracts before enabling new persistence-dependent features. A production cutover requires an independently restored rehearsal, integrity comparison and owner approval. [Phase Zero architecture and capacity audit](DEVELOPMENT_PLAN.md)

## Production architecture revision proposal

Production targets Linux and MySQL with two simultaneous 1080p channels. The current program runtime still has a single selected station and SQLite persistence. The proposed control/worker split uses per-channel ownership, independent encoders, fenced workers and stable provider-facing channel identities. Keep dedicated persistent media and metadata references separate. See [multi-channel architecture](MULTI_CHANNEL_ARCHITECTURE.md), [MySQL migration](MYSQL_MIGRATION_PLAN.md), [Linux deployment](DEPLOYMENT_PLAN.md), [Phase Three media storage and resumable upload architecture](MEDIA_LIBRARY_ARCHITECTURE.md), [Phase Five independent audio and multi-track mixer architecture](AUDIO_ARCHITECTURE.md), [Phase Six server-side playout engine architecture](PLAYOUT_ENGINE_ARCHITECTURE.md), [worker recovery plan](WORKER_RECOVERY_PLAN.md) and [performance benchmarks](PERFORMANCE_BENCHMARKS.md).

## Phase Seven — Server-Side Broadcast Scheduler & Multi-Track Timeline Architecture

- **Engine (`backend/src/infrastructure/scheduler/broadcast-scheduler-engine.js`):** Provides deterministic IANA timezone/DST resolution (`resolveLocalCivilTimeToUtcMs`), bounded recurrence expansion (`expandScheduleOccurrences`, capped at 14 days / 2,000 occurrences), server-side multi-track validation (`validateScheduleRevision`), lease-fenced per-channel execution (`ChannelScheduleExecutor`), and EPG generation (`generateChannelEpgGuide`).
- **Live Playout & Audio Integration:** `ChannelScheduleExecutor` drives `ChannelPlayoutInstance` (`channel-playout-supervisor.js`) for `MAIN_VIDEO`, `LIVE_CAMERA_ROTATION`, `ADVERTISEMENTS`, `GRAPHICS_OVERLAYS`, `NEWS_TICKER`, `MANUAL_SOURCE_OVERRIDE`, and `EMERGENCY_OVERRIDE`, and drives `ChannelAudioEngine` (`audio-mixer-engine.js`) with equal-power crossfading (`startCrossfade`) for `INDEPENDENT_AUDIO`.
- **Durable Ownership & Idempotency:** Atomic CAS leases (`acquireSchedulerLease`), stale-owner fencing (`409 STALE_SCHEDULER_OWNER`), and write-ahead occurrence claiming (`claimOccurrence` on `UNIQUE(occurrenceId)` in `channel_as_run_logs`). See [SCHEDULER_ARCHITECTURE.md](SCHEDULER_ARCHITECTURE.md) and [SCHEDULER_RECOVERY_PLAN.md](SCHEDULER_RECOVERY_PLAN.md).
