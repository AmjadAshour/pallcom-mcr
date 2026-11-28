# Schedule Execution Policies & Six Execution Modes (Phase Seven)

## 1. All Six Execution Modes — Specification & Verification

| # | Execution Mode | Expected Behavior | Actual Implementation (`broadcast-scheduler-engine.js` & `channel-scheduler.js`) | Verification Evidence |
|---|---|---|---|---|
| 1 | **`HARD_START`** | Starts at its exact `plannedStartMs`. Preempts any currently running event on the same track (marking the preempted event `PREEMPTED` in As-Run) and cancels any pending interrupted-movie resume if a primary video `HARD_START` arrives during an ad break. | `ChannelScheduleExecutor.step()` lines 740–845: checks `occ.executionMode === 'HARD_START'`, marks `currentOnTrack` as `PREEMPTED`, clears `interruptedProgram` if primary video preempts an ad break, claims occurrence, and dispatches to `ChannelPlayoutInstance`. | `backend/test/broadcast-scheduler.test.js` (`mode-movie-2-hard` preempting `mode-movie-1` and `mode-ad-before-hard` at `+3,600,100 ms`) & `two-channel-scheduler-acceptance.js`. |
| 2 | **`SOFT_START`** | Waits for the currently active event on the same track to complete before starting. Never cuts off an active program mid-stream. | `ChannelScheduleExecutor.step()` lines 734–737: when `currentOnTrack` is active and `occ.executionMode === 'SOFT_START'`, the occurrence remains unclaimed until `currentOnTrack` completes, then starts on the next tick. | `backend/test/broadcast-scheduler.test.js` (`mode-movie-3-soft` scheduled at `+70m` waits until `mode-movie-2-hard` finishes at `+90m`). |
| 3 | **`FOLLOW_PREVIOUS`** | Chains immediately after the preceding event (`afterEventId` or previous track occurrence) completes. | `expandScheduleOccurrences()` lines 233–245 chains `plannedStartMs = prev.plannedEndMs`, and `ChannelScheduleExecutor.step()` waits if `currentOnTrack` is still running. | `backend/test/broadcast-scheduler.test.js` (`c1-follow-movie` and `mode-movie-4-follow`). |
| 4 | **`FIXED_DURATION`** | Executes for its exact `durationMs` window and terminates automatically when `nowMs >= activeTrack.plannedEndMs`. | `ChannelScheduleExecutor.step()` lines 672–693 completes the active track event at `plannedEndMs`, records `COMPLETED` with `actualDurationMs` and `endErrorMs`, and triggers post-ad movie or camera resumption. | `backend/test/broadcast-scheduler.test.js` & `two-channel-scheduler-acceptance.js` (`ch1-ad`, `ch2-ad`, watermarks, tickers). |
| 5 | **`MANUAL_TRIGGER`** | Never starts automatically on timer ticks; starts only when an authorized operator (`station:control`) dispatches `MANUAL_TRIGGER_EVENT` (or `MANUAL_SOURCE_OVERRIDE`). | `ChannelScheduleExecutor.step()` line 699 skips automatic execution for `MANUAL_TRIGGER`; `POST /channels/:id/scheduler/control` with `action: 'MANUAL_TRIGGER_EVENT'` dispatches the event immediately and logs an As-Run record. | `backend/test/broadcast-scheduler.test.js` (`mode-manual-5` verified dormant on automatic tick and started via `MANUAL_TRIGGER_EVENT`). |
| 6 | **`EMERGENCY_OVERRIDE`** | Highest priority override. Requires `broadcast:emergency` permission (`403` for ordinary operators/viewers). Immediately switches the live GStreamer worker output to the emergency source or `emergency:slate`, suspends all scheduled starts while active, and returns to the active schedule upon `CLEAR_EMERGENCY`. | `POST /channels/:id/scheduler/control` (`EMERGENCY_OVERRIDE` / `CLEAR_EMERGENCY`) invokes `playoutInst.triggerEmergencySwitch()`, logs `EMERGENCY_OVERRIDE` in As-Run, and resumes scheduled playout on clear. | `backend/test/broadcast-scheduler.test.js` (RBAC `403` vs `200`) & `two-channel-scheduler-acceptance.js` (decoded video pixel switch to `BLACK_SLATE` in `490 ms` and recovery to live cameras while Channel 2 remained unaffected). |

---

## 2. Deterministic Precedence Hierarchy

From highest to lowest priority:
1. **`EMERGENCY_OVERRIDE`** (`broadcast:emergency`) — overrides all manual and scheduled states on the target channel.
2. **Manual Operator Override / Hold** (`MANUAL_SOURCE_OVERRIDE`, `HOLD_CURRENT` with `station:control`) — switches live broadcast output to the operator-selected source (with optional `overrideDurationMs` auto-expiry) and suspends automatic track starts until expiry or `RETURN_TO_SCHEDULE`.
3. **`ADVERTISEMENTS` Track Interruption** — interrupts active `MAIN_VIDEO` (saving `resumeOffsetMs`) or overlays `LIVE_CAMERA_ROTATION`, then restores the interrupted program or camera rotation on ad completion unless a primary `HARD_START` event has superseded the interrupted program.
4. **`HARD_START`** — preempts active `FIXED_DURATION`, `SOFT_START`, or `FOLLOW_PREVIOUS` events on the same track.
5. **`SOFT_START` / `FOLLOW_PREVIOUS`** — waits for the active same-track event to complete.
6. **Unscheduled Gap Fallback (`gapPolicy`)** — activates only when no `MAIN_VIDEO`, `LIVE_CAMERA_ROTATION`, or `ADVERTISEMENTS` event is active (`CONTINUE_CURRENT`, `FALLBACK_PLAYLIST`, `FALLBACK_MOVIE`, `FALLBACK_CAMERA`, `CHANNEL_IDENT_CLIP`, `FALLBACK_IMAGE`, `BLACK_SILENCE`).

---

## 3. Live Schedule Publication & Activation Policies

When publishing a validated revision via `POST /api/v1/channels/:channelId/scheduler/publish`:
- **`APPLY_IMMEDIATELY_SAFE`**: Activates the new revision ID immediately on the execution state without restarting the GStreamer encoder process.
- **`APPLY_NEXT_BOUNDARY` / `PRESERVE_CURRENT_ITEM`**: If a primary video program (`MAIN_VIDEO` or `LIVE_CAMERA_ROTATION`) is currently on air, stores the newly published revision in `pendingRevisionId` and activates it automatically as soon as the current primary event reaches its boundary.
- **`APPLY_FUTURE_TIME`**: Stages `pendingRevisionId` until `nowMs >= Date.parse(effectiveFromUtc)`.
- **`REPLACE_CURRENT_AUTHORIZED`**: Immediately activates the new revision and allows due `HARD_START` items in the new revision to preempt the current program.
