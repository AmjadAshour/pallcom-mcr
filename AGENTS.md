# PALLCOM MCR repository instructions

Keep the existing React and Node.js entry points working. Treat the station Agent as the OBS control boundary. Keep raw video and audio processing in media tools or isolated workers. Enforce organization and resource permissions on the server.

Read [master plan](docs/MASTER_PLAN.md), [tasks](docs/TASKS.md), [progress](docs/IMPLEMENTATION_PROGRESS.md), and the [feature matrix](docs/FEATURE_MATRIX.md) before a substantial change. Update affected records with evidence and rollback steps. Use an isolated SQLite database and never send commands to a live OBS station during tests. Obtain explicit authorization before deploying or performing destructive operations. Preserve existing user changes and keep runtime data, secrets, media, and credentials out of Git.

## Permanent specification and phase approvals

Read [MASTER_REQUIREMENTS.md](MASTER_REQUIREMENTS.md) and the [current phase tracker](docs/TASKS.md#current-master-specification-tracker) before starting or resuming a phase. Implement only the phase explicitly approved by the owner. Record actual verification and update the applicable English documentation, then stop for approval before the next phase. Phase 18 requires the separate Phase 17 gate, including the owner-provided design reference and explicit approval of the proposal.
