# Operations runbook

- **ONLINE** means the Agent connection is open and OBS reported connected in recent telemetry. It does not signal streaming or recording.
- **DEGRADED** means the Agent connection is open while OBS is disconnected, unconfirmed or telemetry is stale. Inspect the Agent log and local OBS WebSocket availability.
- **OFFLINE** means the Agent transport is unavailable. Check host and tunnel status before changing OBS Program.
- When responding to a real output incident, follow the station's authorized manual backup procedure. After recovery verify the actual picture and audio at the output, then record the switch and incident.
- If an Agent credential may be exposed, have a station manager use **Settings → Revoke Agent access**. This immediately removes MCR's remote control for the selected station. Generate a fresh pairing code and pair the authorized station host to restore control. Rotate the OBS password separately if it may also have been exposed.
