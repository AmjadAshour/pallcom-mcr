# Broadcast Scheduler Ownership, Fencing & Crash Recovery Plan (Phase Seven)

## 1. Durable Lease Fencing & Write-Ahead Occurrence Claims

To prevent duplicate event execution across competing scheduler instances or unexpected process restarts, Phase Seven implements two database-backed coordination mechanisms in both `SqliteBroadcastSchedulerRepository` and `PrismaBroadcastSchedulerRepository`:

1. **Atomic Compare-and-Set Channel Lease (`acquireSchedulerLease`):**
   - Stored in `channel_scheduler_execution_states` (`leaseOwnerId`, `leaseExpiresAt`).
   - Each `ChannelScheduleExecutor` has a unique `instanceLeaseId`. On every `step(nowMs)`, it atomically acquires or renews a `5,000 ms` lease inside a database transaction (`BEGIN IMMEDIATE` in SQLite / `$transaction` in Prisma).
   - A second competing scheduler instance can acquire the lease **only** if `leaseOwnerId IS NULL` or `leaseExpiresAt <= nowMs`.
2. **Stale Owner Write Fencing (`updateExecutionState` with `{ ownerId }`):**
   - Every state mutation verifies that `leaseOwnerId === ownerId`. If ownership was transferred to another instance after lease expiry, the stale instance is immediately fenced out with HTTP `409 STALE_SCHEDULER_OWNER`.
3. **Durable Write-Ahead Occurrence Claim (`claimOccurrence`):**
   - Before dispatching any due event to `ChannelPlayoutInstance` or `ChannelAudioEngine`, the executor transactionally verifies `leaseOwnerId === ownerId` and inserts a row into `channel_as_run_logs` (`UNIQUE(occurrenceId)`) with `status = 'CLAIMED'`.
   - If the process crashes after claiming or if in-memory `claimedOccurrenceIds` is lost, any subsequent executor instance attempting to claim the same `occurrenceId` receives `{ claimed: false }` from the unique constraint and skips re-dispatching the event.

---

## 2. Controlled Failure Scenarios & Verified Recovery Behavior

| Failure Scenario | Recovery Mechanism | Execution Guarantee & Measured Outcome |
|---|---|---|
| **Scheduler termination before dispatch** | Occurrence was not yet claimed in `channel_as_run_logs`. Upon restart (or standby takeover after 5s lease expiry), the new executor claims and dispatches the occurrence if still within `[plannedStartMs, plannedEndMs)`, or logs `MISSED` if expired. | `0` duplicate executions; expired events never replay late. |
| **Scheduler termination after claim/dispatch before state flush** | `channel_as_run_logs` already contains `UNIQUE(occurrenceId)`. When the replacement executor steps (even with empty `claimedOccurrenceIds`), `claimOccurrence` returns `{ claimed: false }`. | Verified in `backend/test/broadcast-scheduler.test.js`: **`0` duplicate executions**. |
| **Two competing scheduler instances (`Executor A` vs `Executor B`)** | `Executor B` is blocked while `Executor A`'s lease is unexpired, and fenced with `409 STALE_SCHEDULER_OWNER` on direct writes. After `Executor A` stops and its 5s lease expires, `Executor B` takes over and fences `Executor A`. | Verified in `backend/test/broadcast-scheduler.test.js`. |
| **GStreamer worker termination (`SIGKILL`) during scheduled broadcast** | Phase Six `ChannelPlayoutInstance._handleUnexpectedWorkerExit` respawns `channel-worker.py` with exponential backoff (`~2.1s`) and restores the active checkpointed source while the other channel continues uninterrupted. | Verified in `two-channel-playout-acceptance.js` and `two-channel-scheduler-acceptance.js`. |
| **Unavailable or failed scheduled/override media or camera** | `_dispatchOccurrenceToEngine` and `_activateSpecificSource` catch missing/corrupted/excluded sources, log `FAILED_TO_START` or `FALLBACK_ACTIVE`, and immediately activate the channel's configured fallback without stopping the encoder. | Verified in `two-channel-scheduler-acceptance.js`. |

---

## 3. Realistic Execution Guarantees

- **At-Most-Once Automatic Scheduler Dispatch per `occurrenceId`:** Because `claimOccurrence` writes to `channel_as_run_logs` (`UNIQUE(occurrenceId)`) **before** dispatching to the playout worker, a crash in the narrow window between the database commit of `CLAIMED` and the IPC write to `channel-worker.py` favors **at-most-once dispatch** (preventing double ad playout or abrupt movie restarts) rather than re-running an already-claimed occurrence. Meanwhile, `ChannelPlayoutInstance` independently persists its active media/camera checkpoint and recovers the worker process on worker crash.
