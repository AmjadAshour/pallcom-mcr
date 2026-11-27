# API documentation

The existing [API reference](API_SPECIFICATION.md) and [backend reference](../backend/docs/API_DOCUMENTATION.md) describe request details. The Phase Zero route-family inventory below reflects the current working tree. Implementations and route middleware govern actual behavior.

| Route family | Controller or router | Main access boundary |
| --- | --- | --- |
| /api/v1/auth and /users | auth controller and index router | Login/refresh throttling, session checks, user management role, HttpOnly browser session tokens and `no-store` auth responses |
| /api/v1/stations and /pairing | station and pairing controllers | Tenant-bound station roles, pairing claims and revocation |
| /api/v1/stations/:id/program | Program controller | Scoped status/control, station manager selection, receiver credential reports |
| /api/v1/stations/:id/program/hls | Program controller and runtime proxy | Authorized viewer sessions or signed HLS-only tickets. No dashboard access from a playback ticket |
| /api/v1/stations/:id/program/local-scene | Scenes router and native scheduler | Station control plus schedule permissions for edits, transactional assets and jobs |
| /api/v1/stations/:id/program/ads, watermark and ticker | Feature routers | Station and organization scope, validated writes and revision checks |
| /api/v1/stations/:id/scenes, audio, stream, record, replay and studio-mode | OBS controller and Agent gateway | Server authorizes actions; Agent owns the OBS connection |
| /api/v1/stations/:id/playout | Playout router and engine | Station-scoped plans, media scans, control and as-run |
| /api/v1/stations/:id/graphics and /public/graphics | Graphics router | Authenticated management and token-bound legacy browser-source reads |
| /api/v1/automations and /logs | Automation and audit controllers | Authorized station actions and scoped audit queries |
| /health, /socket.io and /agent-ws | Express and realtime gateways | Health metadata, authenticated tenant rooms and Agent credentials |
| /iptv/ | Retired static Nginx IPTV route | Denied for manifests and segments. Use authorized Program HLS. |
| DELETE /api/v1/stations/:id/graphics/link | Revoke the legacy graphics URL | Requires station control in the same organization. Rotate to create a replacement with a 90-day expiry. |

`GET /api/v1/stations` accepts optional `status` (`ONLINE`, `OFFLINE`, `DEGRADED`, `CONNECTING`) and `streamStatus` (`STOPPED`, `STARTING`, `STREAMING`, `STOPPING`) filters. Supply each filter at most once. Empty, unknown or repeated values return HTTP 400. The station list is scoped to the authenticated organization.

On station creation or reassignment, a non-null `studioId` must identify a studio in the station's organization. A missing or out-of-organization studio returns HTTP 404. `PATCH` with `studioId: null` clears the assignment.

Station creation and updates accept only `name`, `studioId`, `description`, `ipAddress`, `obsPort` and `obsPassword`. Extra fields return HTTP 400. Organization and runtime state are server-managed.

Login and Agent pairing claims have independent per-IP limits of 10 requests per 15 minutes. Each endpoint returns HTTP 429 with `Retry-After` when its limit is reached. The global API limit also applies.

`GET /api/v1/logs` requires `audit:read` and returns only the authenticated user's organization events, newest first. The optional `limit` query parameter accepts one integer from 1 to 500 and defaults to 100. Invalid and repeated values return HTTP 400.

`POST /api/v1/users` requires `user:manage` and accepts only `fullName`, `email`, `password` and `role`. Extra properties return HTTP 400. An HTTP 201 response confirms the account and its organization-scoped `USER_CREATED` audit event were saved together. Responses from the users and audit routes carry `Cache-Control: no-store`.
