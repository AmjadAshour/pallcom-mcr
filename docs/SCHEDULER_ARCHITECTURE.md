# Broadcast Scheduler Architecture (Phase Seven)

## Components
- `backend/src/infrastructure/scheduler/broadcast-scheduler-engine.js`: timezone/DST resolver, bounded recurrence expander, server-side validator, `ChannelScheduleExecutor` (per-channel, lease-fenced), `multiChannelScheduler`, EPG generator.
- `backend/src/presentation/routes/channel-scheduler.js`: REST API under `/api/v1/channels/:channelId/scheduler*`.
- Repositories: `SqliteBroadcastSchedulerRepository`, `PrismaBroadcastSchedulerRepository` (MySQL/MariaDB). Migration `20261128_0003_phase07_broadcast_scheduler`.
- UI: `frontend/src/components/playout/MultiTrackBroadcastScheduler.jsx` inside `SchedulerPage.jsx`.

## Model
- Revisions (`channel_schedule_revisions`): DRAFT, VALIDATED, PUBLISHED, SUPERSEDED, ARCHIVED. Published revisions are immutable; edits create/modify a draft. Draft saves use `expectedRevisionNumber` (409 on mismatch).
- Execution state (`channel_scheduler_execution_states`): active/pending revision, per-track state, claimed occurrence IDs, interrupted program state, overrides, lease owner/expiry.
- As-Run (`channel_as_run_logs`): one row per occurrence (unique `occurrenceId`).
- Seven tracks: MAIN_VIDEO, LIVE_CAMERA_ROTATION, INDEPENDENT_AUDIO, ADVERTISEMENTS, GRAPHICS_OVERLAYS, NEWS_TICKER, AUTOMATION_CONTROL.
- Execution drives the Phase Six `ChannelPlayoutInstance` and Phase Five audio repositories; it never touches OBS.

## Security
Permissions: `station:read` (view, as-run, EPG), `schedule:manage` (draft, validate), `schedule:publish` (publish, restore), `station:control` (step, control), `broadcast:emergency` (emergency override). All references are checked against organization and channel. Media referenced by a PUBLISHED revision is delete-protected (`SCHEDULED_PLAYBACK`).
