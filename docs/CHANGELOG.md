# Changelog

## Unreleased

- Added the platform audit, roadmap, 24-module inventory and engineering acceptance process.
- Added Agent transport liveness, OBS telemetry expiry, bounded command backlog and validated telemetry/events. Station list and detail use consistent runtime connection status.
- Added per-station Agent credential rotation, revocation, expiry handling and an audit trail for credential changes.

### Master specification and Phase Zero

Saved the permanent requirements and recorded the current architecture, security findings, verified baseline and phased acceptance tracker. Phase Zero makes documentation changes only. Subsequent phases require explicit owner approval.

## 2026-11-27 — Phase One post-audit work

- End Program audio monitoring at access-token expiry and recheck session and resource eligibility while streaming.
- Protect Windows Agent credential files with DPAPI and restrict Linux credential paths.
- Deny static Compose IPTV and retain authorized playlist/segment delivery in the application.
- Expire new graphics links, support explicit revocation, and limit token-bearing proxy logs.
- Require explicit private UDP contribution opt-in and add sanitized worker and receiver exit diagnostics.
- Adopt the two-channel Linux/MySQL production requirements and publish a proposed dependency order with the original approval gates.
