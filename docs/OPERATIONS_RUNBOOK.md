# Operations runbook

- **ONLINE** means the Agent connection is open and OBS reported connected in recent telemetry. It does not signal streaming or recording.
- **DEGRADED** means the Agent connection is open while OBS is disconnected, unconfirmed or telemetry is stale. Inspect the Agent log and local OBS WebSocket availability.
- **OFFLINE** means the Agent transport is unavailable. Check host and tunnel status before changing OBS Program.
- When responding to a real output incident, follow the station's authorized manual backup procedure. After recovery verify the actual picture and audio at the output, then record the switch and incident.
- If an Agent credential may be exposed, have a station manager use **Settings → Revoke Agent access**. This immediately removes MCR's remote control for the selected station. Generate a fresh pairing code and pair the authorized station host to restore control. Rotate the OBS password separately if it may also have been exposed.

## Master specification evidence

Before an approved maintenance window, record the active version and test an independent receiver. Preserve verified database and media backups and rehearse restoration to a separate path. Restore source and Program state on staging and verify audio, video, timing and output authorization before switching production. Record failure, recovery and rollback timestamps. [Backup and rollback plan](DEVELOPMENT_PLAN.md#backup-and-rollback-procedure)

When validating a fresh SQLite restore, compare station ownership and representative audit events for each organization in addition to media and configuration. Check the source, backup, restored file and their parent directories under the intended service identity. On Windows, verify their effective ACLs explicitly. Keep the protected source and backup available during rollback.

## Offline station encryption rotation rehearsal

The recovery CLI has a rekey mode for SQLite. Run it on a protected backup and supply distinct current and next keys through the maintenance process environment. Keep their values out of shell history, command arguments, documentation and logs. The command is:

```text
node backend/scripts/sqlite-recovery.js rekey <protected-backup.sqlite> <new-candidate.sqlite>
```

The environment variable names are MCR_REKEY_CURRENT and MCR_REKEY_NEXT. The arguments are file paths only. The tool copies the source, updates encrypted station OBS passwords and TOTP secrets in a transaction on the copy, checks integrity and publishes to a new path. It refuses to publish over an existing path or after an incorrect key. It does not rotate signing keys or change account passwords.

Before any real cutover, use an authorized window, take a final backup after writes are quiesced, restrict permissions on both copies, and rehearse startup with the new encryption key on isolated staging. Verify pairing and an independent A/V receiver. Keep the original database and its matching key together for protected rollback. Rollback requires restoring both under an authorized window. Treat old copies as sensitive because credential rotation does not rewrite existing backups.
