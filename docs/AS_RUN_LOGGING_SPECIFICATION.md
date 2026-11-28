# Broadcast As-Run Logging Specification (Phase Seven)

## 1. Schema & Persistence (`channel_as_run_logs` / `ChannelAsRunLog`)

Every executed, interrupted, resumed, preempted, skipped, missed, or override broadcast event is durably recorded in `channel_as_run_logs` (SQLite) and `ChannelAsRunLog` (MySQL/MariaDB via Prisma):

| Column | Type | Description |
|---|---|---|
| `id` | `UUID` (PK) | Unique As-Run log entry identifier. |
| `organizationId` | `VARCHAR(100)` | Tenant organization identifier (enforced on all queries). |
| `channelId` | `VARCHAR(100)` | Broadcast channel / station identifier. |
| `revisionId` / `revisionNumber` | `VARCHAR(100)` / `INT` | Active published schedule revision that produced the event. |
| `eventId` | `VARCHAR(100)` | Schedule event identifier (or `manual-override:*`, `emergency-override:*`, `schedule-gap-fallback`). |
| `occurrenceId` | `VARCHAR(191)` (`UNIQUE`) | Deterministic occurrence key (`${eventId}@${plannedStartMs}`). Enforces database-level idempotency so an occurrence cannot be claimed twice. |
| `trackType` | `VARCHAR(50)` | One of the 7 logical tracks (`MAIN_VIDEO`, `LIVE_CAMERA_ROTATION`, `INDEPENDENT_AUDIO`, `ADVERTISEMENTS`, `GRAPHICS_OVERLAYS`, `NEWS_TICKER`, `AUTOMATION_CONTROL`). |
| `executionMode` | `VARCHAR(50)` | `HARD_START`, `SOFT_START`, `FOLLOW_PREVIOUS`, `FIXED_DURATION`, `MANUAL_TRIGGER`, or `EMERGENCY_OVERRIDE`. |
| `title` / `category` | `VARCHAR` | Human-readable event title and category (`PROGRAM`, `MOVIE_RESUME`, `MANUAL_OVERRIDE`, `EMERGENCY_OVERRIDE`, `FALLBACK`, etc.). |
| `mediaAssetId`, `videoSourceId`, `audioSourceId` | `VARCHAR(100)` (nullable) | Referenced media asset, video source, or audio source. |
| `plannedStartUtc`, `actualStartUtc` | `DATETIME` | Scheduled start timestamp vs actual execution timestamp. |
| `plannedEndUtc`, `actualEndUtc` | `DATETIME` | Scheduled end timestamp vs actual completion/interruption timestamp. |
| `plannedDurationMs`, `actualDurationMs` | `INT` | Planned vs actual duration in milliseconds. |
| `status` | `VARCHAR(50)` | `CLAIMED`, `RUNNING`, `COMPLETED`, `INTERRUPTED_BY_AD`, `PREEMPTED`, `SKIPPED_BY_OPERATOR`, `MISSED`, `FAILED_TO_START`, `FALLBACK_ACTIVE`, `MANUAL_OVERRIDE`, or `EMERGENCY_OVERRIDE`. |
| `interruptionReason` | `TEXT` | Exact reason for preemption, ad pause offset, operator skip, or missed window. |
| `resumeOffsetMs` | `INT` | Saved playback position (ms) when resuming a movie after an advertisement break. |
| `workerConfirmed` | `BOOLEAN` | `true` only when the live GStreamer worker or audio engine confirmed actual execution; `false` for config-only or missed events. |
| `details` | `JSON` | Structured telemetry (`startErrorMs`, `endErrorMs`, `commandLatencyMs`, `pausedAtOffsetMs`, `dispatched`). |

---

## 2. CSV Export & Formula Injection Protection

- **Endpoint:** `GET /api/v1/channels/:channelId/scheduler/as-run?format=csv` (requires `station:read` and channel ownership within `req.user.organizationId`).
- **Spreadsheet Formula Injection Protection:** Every exported CSV cell is sanitized through `csvTextCell()` (`@mcr/shared`), which prefixes values beginning with `=`, `+`, `-`, `@`, tab, or carriage return with a leading single quote (`'`) before RFC-4180 quoting. Verified by `backend/test/broadcast-scheduler.test.js` with `=CMD|' /C calc'!A0`.
