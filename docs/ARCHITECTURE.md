# Target architecture

Keep the current Node/React control plane. Add an isolated media plane behind a typed worker adapter once the worker identity and lifecycle contract is testable. Prefer GStreamer for dynamic pipelines and FFmpeg/ffprobe for suitable conversion and metadata operations. Negotiate capabilities with measurements before showing hardware acceleration as available.

Keep SQLite for existing single-node deployments. Evaluate MySQL 8.4 only when multi-node persistence requirements justify migration and equivalent backup/restore, transactions and isolation tests pass. Store large assets in files or object storage. See [ADR 0001](decisions/0001-control-media-boundary.md).

## Master specification planning decision

The current [master specification](../MASTER_REQUIREMENTS.md) requires MySQL for persistent relational storage. The existing SQLite deployment described above remains the verified baseline. The target is a typed Express-to-worker interface, durable channel state and leases, MySQL metadata and file/object-backed media. Define adapter and migration contracts before enabling new persistence-dependent features. A production cutover requires an independently restored rehearsal, integrity comparison and owner approval. [Phase Zero architecture and capacity audit](DEVELOPMENT_PLAN.md)

## Production architecture revision proposal

Production targets Linux and MySQL with two simultaneous 1080p channels. The current program runtime still has a single selected station and SQLite persistence. The proposed control/worker split uses per-channel ownership, independent encoders, fenced workers and stable provider-facing channel identities. Keep dedicated persistent media and metadata references separate. See [multi-channel architecture](MULTI_CHANNEL_ARCHITECTURE.md), [MySQL migration](MYSQL_MIGRATION_PLAN.md) and [Linux deployment](DEPLOYMENT_PLAN.md).
