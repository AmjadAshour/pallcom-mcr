# Known issues and evidence gaps

- Real OBS output, frame-accurate takes and on-air continuity lack current evidence. Use isolated OBS staging before relying on automated switching.
- The watchdog observes WebSocket and OBS telemetry, with no direct freeze, black, loudness or transport-stream analysis.
- MFA, hardened credential enrollment and tamper-evident audit storage remain pending.
- Real ingest/media workers, WebRTC/TURN, compatible device tests, GPU capacity, licensed CAS/watermarking and production endurance results remain open. See [feature matrix](FEATURE_MATRIX.md).
