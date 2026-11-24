# Database schema

The active schema is defined in [sqlite.js](../backend/src/infrastructure/database/sqlite.js). Operational domains include organizations, users and auth sessions; studios/stations and pairing; station graphics, automations, playout and as-run records; audit logs. FFT/media binaries and videos stay outside the database. The new Agent connection heartbeat and telemetry freshness are in memory and reset at reconnect. See [deployment](DEPLOYMENT.md) for data backup requirements.

`station_agent_credentials` stores only the current positive generation per station. Absence denotes legacy generation zero. The row is removed with the station. Generation changes, pairing-code invalidation and the audit event commit in one transaction. Agent tokens and OBS passwords are excluded from these audit events.
