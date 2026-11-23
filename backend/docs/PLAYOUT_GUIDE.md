# TV playout

Open **Scheduler** and choose a station. Existing one-off scheduler jobs remain under **Scheduled jobs**.

## Prepare the OBS machine

1. Configure directories on the machine running the OBS Agent. Put the setting in its local project `.env`, or export it before starting the Agent. Use absolute paths. Windows separates directories with semicolons. Linux and macOS use colons.
   ```powershell
   $env:MCR_MEDIA_ROOTS = 'D:\OnAir;D:\Filler'
   node backend/agent/src/index.js start
   ```
2. In OBS, create two scenes with distinct Media Sources (for example **Deck A / Media A** and **Deck B / Media B**). Keep those media sources dedicated to their respective decks and enabled, and do not reuse them inside other Program scenes. Set up a backup scene that can stay on air indefinitely. Make the deck scenes visually equivalent if you want a continuous station look.
3. Enter the exact scene and source names in **OBS settings**, then **Save & apply immediately**. For a live input, first configure an OBS scene that receives the RTMP or NDI feed, then schedule that scene as a timed live block. MCR switches the scene and does not ingest the feed separately.
4. Open **Media library**, scan the configured folders, and add assets to the main or fallback queue. The Agent runs ffprobe on local media without accepting filesystem paths from the dashboard. Use an installed FFmpeg distribution via `FFPROBE_PATH` if the included binary does not support your media or platform.
5. Confirm the backup is visible and ready, then **Start playout**. Use **Release automation** to give OBS Program back to the operator. This releases control without cutting or stopping media already on air.

## Scheduling and overrides

- The main queue follows its order until a fixed event becomes due. Times use browser-local date/time for entry and epoch milliseconds on the server. Reorder the upcoming sequence and save without reopening the active media source. Every save is version-checked against the current schedule.
- Fixed events can preempt a currently airing item. A missed fixed event whose entire window elapsed while the station was unavailable is logged rather than replayed. Approaching fixed starts and item transitions can cue the standby deck in advance.
- Enable **24/7 loop** to replay eligible non-fixed items. The fallback playlist repeats when the main queue cannot provide a playable item. If the fallback is exhausted or fails, the engine attempts the configured backup scene.
- **Play next now**, **Restart current**, and **Emergency cut** are operational controls. A manual Program scene change in OBS releases automation. On reconnect, automation checks whether its last Program is still on air before it regains control.
- Configure named OBS scene sources for logo, now/next, and ticker. The now/next overlay needs a text source. Configure equivalent sources on each deck, live and backup scene as required. The existing Browser Source graphics page is independent.
- **As-run log** shows planned and confirmed start times, end times, and failure/interruption outcomes. An optional audible alert requires enabling it in the browser.

## Timing and operating limits

Schedules and logs use millisecond timestamps, and cueing avoids interrupting Program while the next media source is prepared. Actual picture timing depends on Node.js scheduling, Agent latency, OBS frame rate, source decoding, and the configured scenes. Measure the planned-versus-confirmed timestamps on your production network. This is not a frame-locked or redundant playout system.

Run one scheduler process against a station's SQLite database. It persists the queue, active item and log, but it cannot guarantee uninterrupted output when OBS, its network, storage, or the backup feed itself fails. Test the backup independently before going live. ffprobe checks metadata and obvious readability problems; it does not decode every frame.

## API data

Under `/api/v1/stations/:id/playout`, GET returns a snapshot and PUT applies a revision. A plan contains `revision`, `items`, `filler`, `loop`, `decks`, `backupScene`, and `graphics`. Items have `id` (UUID), `title`, `kind` (`media` or `live`), `category`, `durationMs`, and `hardStartAt` (epoch milliseconds or null), with `assetId` for media or `sceneName` for live. A deck has `sceneName` and `inputName`. Media duration is normalized from the scanned library. Filler must be unpinned media.

Additional paths are `/assets`, `/scan`, `/health`, `/control`, and `/as-run`. Socket.IO clients subscribe with `playout:subscribe` and receive scoped `playout:state` snapshots. Edit and control routes require station control permissions.
