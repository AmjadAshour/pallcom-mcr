# As-Run Logging Specification (Phase Seven)

Table `channel_as_run_logs` (one row per `occurrenceId`): revision, event, track, mode, title, category, references, planned/actual start and end, planned/actual duration, `status` (`RUNNING`, `COMPLETED`, `INTERRUPTED_BY_AD`, `PREEMPTED`, `SKIPPED_BY_OPERATOR`, `MISSED`, `FAILED_TO_START`, `FALLBACK_ACTIVE`), `interruptionReason`, `resumeOffsetMs`, `workerConfirmed`, `details`.

`workerConfirmed` is true only when the dispatch reached a running channel worker; config-only dispatch is recorded as `false`.
API: `GET /api/v1/channels/:channelId/scheduler/as-run?limit=&trackType=&status=&format=csv` (`station:read`). CSV cells pass through `csvTextCell` to prevent formula injection.
