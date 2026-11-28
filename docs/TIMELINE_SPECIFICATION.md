# Timeline Specification (Phase Seven)

- Event fields: `id`, `trackType`, `executionMode`, `title`, `startUtc` or `localStartDateTime` (+ `dstDisambiguation`), `durationMs` (500 ms to 96 h), `priority`, `allowPreemption`, `afterEventId`, `recurrence`, references (`mediaAssetId`, `videoSourceId`, `audioSourceId`), `metadata`.
- Recurrence: `ONCE`, `DAILY`, `WEEKLY`, `SELECTED_WEEKDAYS`, with `exceptionDates`, `untilUtc`, `count`. Expansion is bounded to 14 days and 2,000 occurrences per call. Exception dates count toward `count` (they are skipped slots).
- Time zones: IANA zone per revision. Local times are resolved deterministically. Nonexistent spring-forward times fail with `DST_NONEXISTENT_TIME`; ambiguous fall-back times fail with `DST_AMBIGUOUS_TIME` unless `EARLIER` or `LATER` is chosen (they differ by exactly 3,600,000 ms).
- Validation errors (block publish): invalid track/mode/duration, end before start, DST errors, missing/foreign/unready references, cross-channel video/audio sources, circular `afterEventId`, conflicting HARD_START overlaps, unresolved track overlaps. Warnings: HARD_START preemption. `gaps`: uncovered time between primary video events.
- Compatible overlaps across tracks (e.g. watermark over movie) are allowed.
