# Security release gates

Production approval remains open. These gates extend [the Phase One ledger](PHASE_ONE_GATES.md) and retain its historical evidence.

| Gate | Status | Evidence or remaining requirement |
| --- | --- | --- |
| Audio session lifetime | Local verification | Synthetic audio must stop on access-token or session expiry, revocation, lost role and organization changes while the independent UDP output continues. See the executed checks in the test report. |
| Agent storage and service identity | Partial | Verified current-user Windows encryption, restricted ACL and legacy migration on a generated fixture. Confirm distinct deployed service identities, Windows account migration and Linux permissions on authorized hosts. |
| IPTV exposure | Partial | Repo config denies the static manifest and segment paths and removes the shared web volume. An isolated receiver run verified station and session scope for the signed manifest and segments. Prove the alternative direct path is unreachable from actual Nginx, backend and provider networks in Linux staging. Provider-specific grants require the later delivery work. |
| Contribution and logs | Partial | Loopback default, explicit private UDP opt-in, scoped HTTPS proxy and expiring new graphics links. Actual Windows Nginx verified that synthetic graphics and HLS credentials stayed out of access and error logs, including upstream failure. Require deployed platform logs, firewall policy, isolated workers and authenticated acceptance for each future contribution protocol. |
| Source and history credentials G8 | Blocked | Prior redacted source/history scans found a generic credential-type item in environment configuration. Exact-match scanning also found local bootstrap and signing/encryption material reused in tracked history. Determine affected installations and credential owners without exporting values. |
| Advisory review G18 | Blocked | Public OSV tool and bulk advisory downloads timed out before either could be verified and used offline. Supply a complete offline bundle or an approved private scanner. External npm auditing still requires authorization to disclose production package names and versions, including possible private workspace names. [Acquisition record](TEST_REPORT.md#offline-advisory-acquisition-attempt) |
| Linux, OBS and service isolation G4/G50/G51 | Blocked | The Windows loopback Nginx run verified real API and Chromium traffic plus real Agent traffic against an OBS simulator. Provision approved isolated Linux staging with Docker, Nginx/TLS, private network-policy inspection and separate authorized OBS setup. Verify production-like ACL, backup identity, local egress and quotas. |
| Native HLS G56 | Open | A missing worker reproduced the Windows assertion under Node 24.15.0 during fixture shutdown. The fixture now reports a normal failure on both Node 22 and 24 in that scenario. Three sequential Node 22 playback runs passed. Verify the original intermittent failure and repeat qualification on Linux. [Runtime evidence](TEST_REPORT.md#node-22-runtime-compatibility-and-hls-fixture-cleanup) |

## Credential cutover proposal

Inventory applications, stations, backups and secret references using metadata and owner records. Confirm how access and refresh signing, enrollment, OBS passwords, bootstrap credentials and encryption keys are used. Have the owner approve the maintenance window, retention scope and data recovery target.

Create per-environment replacements in an approved secret store. Rehearse encrypted copy rekey, restoration and the account/token cutover in isolation first. Use distinct access and refresh keys. Invalidate affected sessions and pairing credentials and verify authentication, station reconnect and receiver continuity. Coordinate credential changes with each affected downstream OBS/Agent rather than attempting a fleet-wide simultaneous restart. Preserve a protected old-key backup only for authorized recovery until the migration is independently proven and retention expires.

Attach sanitized validation of outcomes and revoke superseded credentials. Preserve historical evidence. Any production rotation, history rewriting or external audit requires its own authorization.
