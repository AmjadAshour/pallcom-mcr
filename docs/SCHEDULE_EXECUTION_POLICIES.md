# Schedule Execution Policies (Phase Seven)

- `HARD_START`: starts at its time; preempts the current item on the same track (As-Run `PREEMPTED`).
- `SOFT_START`: waits for the current item on its track to finish.
- `FOLLOW_PREVIOUS`: starts when the previous item on the track ends.
- `FIXED_DURATION`: runs for exactly `durationMs`.
- `MANUAL_TRIGGER`: never started automatically.
- `EMERGENCY_OVERRIDE`: requires `broadcast:emergency`; suspends scheduled starts until cleared.
- Missed events (window expired before execution) are logged `MISSED` and never replayed late.
- Mid-movie advertisement: the movie offset is stored (`interruptedProgramState.resumeOffsetMs`), the ad is played, and the movie resumes at that offset (As-Run category `MOVIE_RESUME`). If the playout engine already resumed at the offset, the scheduler does not seek twice.
- Ad over a live camera block: camera rotation is restored when the ad completes.
- Gap fallback: when no primary video is active, the revision gap policy fallback is activated (`FALLBACK_ACTIVE`).
- Activation policies: `APPLY_IMMEDIATELY_SAFE`, `APPLY_NEXT_BOUNDARY`, `APPLY_FUTURE_TIME`, `PRESERVE_CURRENT_ITEM`, `REPLACE_CURRENT_AUTHORIZED`.
- Duplicate prevention: `claimedOccurrenceIds` plus lease owner/expiry fencing.
