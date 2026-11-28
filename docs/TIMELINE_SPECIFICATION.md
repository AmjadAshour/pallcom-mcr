# Multi-Track Broadcast Timeline Specification (Phase Seven)

## 1. Seven Logical Broadcast Tracks

Every channel schedule revision organizes events across seven logical tracks (`SCHEDULE_TRACK_TYPES` in `@mcr/shared`):

1. **`MAIN_VIDEO`**: Prerecorded Full HD movies, episodes, programs, intros/outros, and station idents (`MediaAsset` with `hasVideo = true`). Exclusive within itself; contends with `LIVE_CAMERA_ROTATION` for primary video output.
2. **`LIVE_CAMERA_ROTATION`**: Scheduled live IP camera feeds or multi-camera rotation blocks (`VideoSource` or `metadata.cameraSequence`).
3. **`INDEPENDENT_AUDIO`**: Background music playlists, uploaded audio tracks, internet radio streams, and scheduled audio level/routing changes (`AudioSource`). Runs concurrently with primary video tracks.
4. **`ADVERTISEMENTS`**: Commercial breaks and promotional spots. When an `ADVERTISEMENTS` event triggers during an active `MAIN_VIDEO` movie, the movie's elapsed playback offset (`resumeOffsetMs`) is saved in `interruptedProgramState`, the advertisement plays on air, and the movie automatically resumes from `resumeOffsetMs` upon ad completion. When an ad triggers over `LIVE_CAMERA_ROTATION`, camera rotation resumes automatically after the ad.
5. **`GRAPHICS_OVERLAYS`**: Scheduled watermarks, bugs, and lower-third overlays (`MediaAsset` image or `metadata.bitmap`). Compatible overlap with primary video and audio tracks.
6. **`NEWS_TICKER`**: Scheduled crawling ticker text (`metadata.tickerText`). Exclusive within `NEWS_TICKER`; compatible with primary video and audio tracks.
7. **`AUTOMATION_CONTROL`**: Timed control markers and audio routing/ducking policy switches (`metadata.action`, `metadata.routingMode`).

---

## 2. Event Schema & Timezone / DST Resolution

Each scheduled event is validated by `scheduleEventSchema` in `backend/src/presentation/routes/channel-scheduler.js`:

- **Identifiers & Metadata:** `id` (unique within revision), `trackType`, `executionMode`, `title`, `description`, `category`, `priority` (`0`–`100`), `allowPreemption` (`boolean`), `afterEventId` (for `FOLLOW_PREVIOUS`), `transitionType` (`CUT` | `CROSSFADE` | `FADE_BLACK`), `transitionDurationMs` (`0`–`15,000 ms`).
- **Timing:** Either explicit UTC (`startUtc`, optional `endUtc`) or local civil time (`localStartDateTime` in `YYYY-MM-DDTHH:mm:ss` format) evaluated in the schedule revision's IANA `timezone`, plus `durationMs` (`500 ms` to `345,600,000 ms` / 96 hours).
- **Daylight Saving Time (DST) Disambiguation (`resolveLocalCivilTimeToUtcMs`):**
  - **Spring-Forward Nonexistent Local Times:** Local times that fall inside a DST spring-forward gap (e.g., `2026-03-08T02:30:00` in `America/New_York`) are deterministically detected and rejected with `400 DST_NONEXISTENT_TIME`.
  - **Fall-Back Ambiguous Local Times:** Local times that occur twice during a DST fall-back fold (e.g., `2026-11-01T01:30:00` in `America/New_York`) are rejected by default (`dstDisambiguation: 'REJECT'` $\rightarrow$ `400 DST_AMBIGUOUS_TIME`) and resolved deterministically when `dstDisambiguation` is set to `'EARLIER'` (first pass / daylight time) or `'LATER'` (second pass / standard time, separated by exactly `3,600,000 ms`).

---

## 3. Bounded Recurrence & Exception Dates

`expandScheduleOccurrences` supports `ONCE`, `DAILY`, `WEEKLY`, and `SELECTED_WEEKDAYS` (`weekdays: [0..6]`) with optional `untilUtc`, `count` (up to `2,000`), and `exceptionDates` (`YYYY-MM-DD` in the channel's local timezone):

- **Bounded Expansion:** Every expansion call is hard-capped at `MAX_WINDOW_EXPANSION_MS` (14 days) and `MAX_EXPANDED_OCCURRENCES` (2,000 occurrences) to prevent CPU or memory exhaustion.
- **Local Civil Air-Time Preservation Across DST:** Recurring events anchored to `localStartDateTime` expand by local civil date in the channel's timezone so daily programs stay at the same local clock time before and after DST transitions.
- **Exception Dates (`exceptionDates`):** Dates listed in `exceptionDates` count toward the recurrence `count` slot budget and are omitted from the expanded occurrences.

---

## 4. Server-Side Conflict & Gap Detection Rules

`validateScheduleRevision` separates blocking **errors** (which prevent schedule publication with HTTP `409`) from operator **warnings** and primary timeline **gaps**:

- **Blocking Errors:**
  - `INVALID_TIMEZONE`, `MISSING_EVENT_ID`, `DUPLICATE_EVENT_ID`, `INVALID_TRACK_TYPE`, `INVALID_EXECUTION_MODE`, `INVALID_DURATION`, `END_BEFORE_START`
  - `DST_NONEXISTENT_TIME`, `DST_AMBIGUOUS_TIME`
  - `MISSING_OR_FOREIGN_MEDIA_ASSET`, `UNREADY_MEDIA_ASSET`
  - `MISSING_OR_FOREIGN_VIDEO_SOURCE`, `CROSS_CHANNEL_VIDEO_SOURCE`
  - `MISSING_OR_FOREIGN_AUDIO_SOURCE`, `CROSS_CHANNEL_AUDIO_SOURCE`, `CROSS_CHANNEL_REFERENCE`
  - `CIRCULAR_EVENT_DEPENDENCY` (cycle detection on `afterEventId`)
  - `CONFLICTING_HARD_STARTS` (two overlapping `HARD_START` events on the same exclusive track)
  - `SIMULTANEOUS_PRIMARY_VIDEO_HARD_START` (simultaneous `HARD_START` on `MAIN_VIDEO` and `LIVE_CAMERA_ROTATION`)
  - `TRACK_OVERLAP_CONFLICT` (overlapping non-preemptible events on an exclusive track)
- **Operator Warnings:**
  - `HARD_START_PREEMPTS_PREVIOUS` (a `HARD_START` event overlaps an earlier preemptible event on the same track and will preempt it at runtime).
- **Gap Detection (`gaps` array):**
  - Identifies every uncovered interval (`b.plannedStartMs > a.plannedEndMs`) between consecutive primary video occurrences (`MAIN_VIDEO` and `LIVE_CAMERA_ROTATION`) and reports `startUtc`, `endUtc`, `durationMs`, `precedingEventId`, and `followingEventId`.

---

## 5. Professional Timeline UI Verification Matrix (`MultiTrackBroadcastScheduler.jsx`)

Verified by real headless Chromium browser execution (`backend/verification/scheduler-browser-loopback.js`, exit code `0`):

| # | Timeline Feature | Status | Implementation & Verification Evidence |
|---|---|---|---|
| 1 | Seven logical tracks | `VERIFIED_COMPLETE` | All 7 `[data-testid="timeline-track-*"]` tracks rendered and verified in Chromium DOM. |
| 2 | Day view | `VERIFIED_COMPLETE` | 24-hour time ruler (`[data-testid="timeline-time-ruler"]`) + 7 track lanes in `DAY` mode. |
| 3 | Week view | `VERIFIED_COMPLETE` | 7-day occurrence summary grid (`[data-testid="week-view-grid"]`) verified in Chromium. |
| 4 | Channel selection | `VERIFIED_COMPLETE` | Station/channel selector in `SchedulerPage.jsx` re-keys `MultiTrackBroadcastScheduler` per channel. |
| 5 | Date selection | `VERIFIED_COMPLETE` | `input[type="date"]` reloads window occurrences for the chosen date. |
| 6 | Drag-and-drop event placement | `VERIFIED_COMPLETE` | Draggable source palette items (media, cameras, audio) drop onto any track (`handleDropOnTrack`). |
| 7 | Moving events | `VERIFIED_COMPLETE` | Dragging existing event cards across tracks or changing track in inspector + `-15m`/`+15m` buttons. |
| 8 | Resizing events | `VERIFIED_COMPLETE` | `Dur-` / `Dur+` buttons and direct duration/end-time editing verified in Chromium. |
| 9 | Timeline zoom | `VERIFIED_COMPLETE` | `Zoom In` / `Zoom Out` (`4h` to `72h`) adjusts time ruler scale. |
| 10 | Horizontal scrolling | `VERIFIED_COMPLETE` | `overflow-x-auto` on track lanes and time ruler. |
| 11 | Time-grid snapping | `VERIFIED_COMPLETE` | Configurable snap selector (`1`, `5`, `15`, `30`, `60 min`) via `snapToGridMs`. |
| 12 | Current-time playhead | `VERIFIED_COMPLETE` | Live red playhead (`[data-testid="live-playhead-indicator"]`) updated every second. |
| 13 | Multi-item selection | `VERIFIED_COMPLETE` | Per-card checkbox and Shift/Ctrl-click multi-selection (`selectedEventIds`). |
| 14 | Copy and paste | `VERIFIED_COMPLETE` | `Copy` and `Paste` / `Paste Here` buttons duplicate selected events onto target track snapped to grid. |
| 15 | Event duplication | `VERIFIED_COMPLETE` | Per-card `Duplicate Event` button verified in Chromium (`Prime Time Browser Feature (Copy)`). |
| 16 | Event deletion | `VERIFIED_COMPLETE` | Single-card `Delete Event` and bulk `Delete Selected` verified in Chromium. |
| 17 | Direct start and end time editing | `VERIFIED_COMPLETE` | Inspector inputs for `Start Date/Time`, `End Date/Time (Direct)`, and `Duration (seconds)`. |
| 18 | Media library selection | `VERIFIED_COMPLETE` | Modal and inspector dropdowns populated from `/api/v1/media`. |
| 19 | Video source selection | `VERIFIED_COMPLETE` | Modal, inspector, and manual override dropdowns populated from `/api/v1/video-sources`. |
| 20 | Audio source selection | `VERIFIED_COMPLETE` | Modal and inspector dropdowns populated from `/api/v1/channels/:id/audio/sources`. |
| 21 | Advertisement selection | `VERIFIED_COMPLETE` | Dedicated `Advertisement Spot` selector filtering `ADVERTISEMENTS`/`PROMOS` assets. |
| 22 | Recurrence editing | `VERIFIED_COMPLETE` | Modal and inspector recurrence frequency selector + `+Exc` exception date editor. |
| 23 | Conflict indicators | `VERIFIED_COMPLETE` | Red warning badge (`⚠`) and red border ring on conflicting event cards + validation banner. |
| 24 | Gap indicators | `VERIFIED_COMPLETE` | Validation banner lists every unscheduled gap duration, start/end UTC, and active gap policy. |
| 25 | Draft management | `VERIFIED_COMPLETE` | `Save Draft` (`PUT /scheduler/draft`) with `Draft vN` badge and optimistic locking. |
| 26 | Schedule publication | `VERIFIED_COMPLETE` | `Publish Schedule` (`POST /scheduler/publish`) verified in Chromium (`Published v1` badge). |
| 27 | Revision history | `VERIFIED_COMPLETE` | `REVISIONS` tab listing all revisions with `Restore to Draft` action. |
| 28 | Undo and redo for draft editing | `VERIFIED_COMPLETE` | 20-step `undoStack` / `redoStack` verified in Chromium after event duplication. |
| 29 | Keyboard-accessible editing alternatives | `VERIFIED_COMPLETE` | Focusable `-15m`, `+15m`, `Dur-`, `Dur+`, `Trigger`, `Copy`, `Delete`, and inspector form controls. |
