# Current architecture

React calls the Express JSON API and subscribes to scoped Socket.IO updates. Express authenticates the user and checks organization/role. An Agent at the station makes an outbound authenticated WebSocket connection, receives structured commands, and controls OBS locally via WebSocket v5. The station Agent scans allowed media roots using ffprobe. OBS handles Program, Preview, recording and streaming. The scheduler is in-process; SQLite stores its plans, active state and as-run log.

Sources, configuration, media and output remain on the station host where OBS owns them. Current commands and acknowledgement flows are referenced in [existing backend architecture](../backend/docs/ARCHITECTURE.md).
