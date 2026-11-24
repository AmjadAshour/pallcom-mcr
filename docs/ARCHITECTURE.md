# Target architecture

Keep the current Node/React control plane. Add an isolated media plane behind a typed worker adapter once the worker identity and lifecycle contract is testable. Prefer GStreamer for dynamic pipelines and FFmpeg/ffprobe for suitable conversion and metadata operations. Negotiate capabilities with measurements before showing hardware acceleration as available.

Keep SQLite for existing single-node deployments. Evaluate MySQL 8.4 only when multi-node persistence requirements justify migration and equivalent backup/restore, transactions and isolation tests pass. Store large assets in files or object storage. See [ADR 0001](decisions/0001-control-media-boundary.md).
