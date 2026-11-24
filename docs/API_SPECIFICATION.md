# API specification

See the [existing API documentation](../backend/docs/API_DOCUMENTATION.md), [route definitions](../backend/src/presentation/routes/index.js) and [playout API](../backend/docs/PLAYOUT_GUIDE.md). Extend the current bearer/cookie REST surface with resource-level permission checks and consistent response validation.

The Agent tunnel at `/agent-ws` authenticates a station token. It accepts command acknowledgements/errors tied to pending correlation IDs, typed `TELEMETRY`, and allowlisted `OBS_EVENT` payloads with unknown fields stripped. It uses WebSocket ping/pong for transport liveness. A connected station without current OBS telemetry is DEGRADED. The protocol change adds no new outbound command.

`POST /api/v1/stations/:id/agent/revoke` requires `station:manage` and station ownership by the caller's organization. It invalidates existing Agent tokens and outstanding pairing codes for that station and closes its registered tunnel. A successful pairing similarly rotates the station credential. Legacy Agent tokens are accepted for stations without a recorded credential generation. The existing token expiry is enforced on established tunnels at the next watchdog tick.
