# Test plan

Run the Node suite against a temporary SQLite path, build frontend/backend, and audit the production dependency lockfile. Keep Agent/OBS tests isolated from the on-air instance. Assert grant and denial, stale/lost transport, backlog rejection, schema filtering, and continued operation after reauthorization.

For media features, attach reference inputs and assert decoded output, media timestamps, A/V sync, independently measured bitrate and failover time. Add Playwright journeys for sign-in, station selection, alarms, Program/Preview and timeline. Run fault injection in staging and 1/8/24/72-hour soaks as capacity permits. Record environment, tool versions, measurements and limits in [progress](IMPLEMENTATION_PROGRESS.md).
