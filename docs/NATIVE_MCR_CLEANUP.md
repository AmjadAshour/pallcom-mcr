# Native MCR cleanup

## Inventory and implementation plan

| Surface | Decision | Replacement or dependency |
| --- | --- | --- |
| Dashboard and header | REFACTOR | Replace fabricated availability and operator data with actual station and session data. Keep the emergency OBS scene action only when the live integration supports it. |
| Stations | MERGE | Create a station with a name. Existing optional OBS settings remain editable in the dedicated integration page. Keep station access and deletion checks. Remove duplicate OBS recording and streaming buttons and route operators to Live Control. |
| Live Control and multiview | KEEP | Native Program input, preview, output, fallback and monitoring are established. OBS Studio Mode, transitions, replay and snapshots have different command paths and remain compatibility features for connected stations. |
| Sources and scheduling | REFACTOR | Native named scenes, video upload, sequence and schedule remain in Sources and Scenes. OBS scheduler owns long-form playout, media roots, deck control and its as-run history. Keep its direct route and group it under OBS integrations. |
| Audio and graphics | KEEP | Preserve native audio mix, monitoring, ads, watermark and ticker. OBS audio input controls remain for connected stations. The old OBS graphics editor has already been removed from the workspace. Keep the existing browser-source endpoint and links that may be embedded externally. |
| Macros and connection settings | VERIFY | The verified actions target OBS, and native Program has no equivalent for their full scope. Keep as optional integrations. |
| Users, logs and sessions | KEEP | Existing authentication, role controls, organization checks and audit are shared by both paths. |
| Express routes and worker | KEEP | Program, ads, scenes, audio, HLS and scheduling use the isolated worker and SQLite. Agent RPC and protected OBS endpoints serves the remaining compatibility workflows. |
| npm workspaces | REMOVE | Remove the unused direct OBS client dependency from the server manifest. The Agent imports the adapter and still needs it. |
| Prisma, MySQL and database fields | VERIFY | The repository factory returns SQLite repositories; sessions, scheduling and Program also use SQLite directly. MySQL schema and seed code alone do not provide MySQL runtime parity. Retain data and schema. |

1. Capture and reverse-check a source patch of the existing working tree so prior edits can be recovered.
2. Group the navigation, load routes as needed, simplify station setup, and remove verified duplicate controls.
3. Check both builds, permissions and existing repository tests with isolated SQLite. Run the native media fixture without OBS. Verify navigation in the browser where available.
4. Record remaining compatibility paths and rollback steps. A MySQL migration and decommissioning of active OBS workflows require separate acceptance evidence.

## Delivered changes and verification

- Previous navigation was a flat list of twelve destinations. The current sidebar groups Broadcast, Administration and optional OBS Integration. Saved URLs still work. The sidebar expands and collapses, and protected administration links are shown according to the session permissions.
- Frontend changes are in App, DashboardLayout, Header, Sidebar, OverviewPage, StationsPage, LiveControlPage, AudioMixerPage and IndependentProgram. The existing working tree also contains the preceding graphics, station assignment and HLS work.
- Station creation uses the existing API defaults and requires a name. OBS stream and recording controls are centralized in Live Control. Emergency cut is available in the connected OBS panel when the designated scene exists. Stop and slate actions confirm before sending commands. The overview removed the fixed availability percentage and identifies metrics sourced from OBS.
- Server manifest and lockfile drop the unused direct OBS client dependency. The Agent still imports that package. No server endpoint, database field, schema migration or data deletion was needed for this cleanup. The pre-existing Program station-selection table belongs to the prior browser setup change.
- Both builds and 28 repository tests passed. The final frontend build also passed its bundle-secret and polling tests. Browser checks opened all twelve routes, expanded the sidebar and verified Arabic RTL. The isolated native fixture uploaded MP4 and decoded the video-only scene with OBS closed. FFmpeg emitted H.264 parameter-set warnings during acquisition.
- Route splitting reduced the main JavaScript entry from 481.62 kB to 246.90 kB before gzip in local Vite builds. Additional chunks are fetched when their pages open. No CDN or cloud dependency was added.
- Remaining acceptance includes MySQL parity, independent replacements for OBS playout and replay, HLS playback through the authenticated site, remote deployment, and extended broadcast sessions. Keep the OBS Agent adapter and existing stored jobs until those workflows have verified replacements.
- Roll back the navigation, layout, page and manifest changes together. Preserve the preceding working-tree changes using the pre-cleanup patch. No database rollback is required for this cleanup.
