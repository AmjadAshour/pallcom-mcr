# Security audit

## Initial phase review

- The Agent gateway accepted arbitrary event names and fields and had no liveness timeout or explicit per-station pending-command bound. Phase P0-002 now validates accepted telemetry/events, strips surplus fields, applies liveness checks, and bounds frames and commands. Evidence is in the gateway test and progress log.
- Argon2id, HTTP and Socket.IO session checks, scoped station routes, hardened cookies and TLS configuration are present. Production TLS, MFA, recovery, Agent credential rotation, and audit integrity remain open.
- Agent command results still require command-specific validation and safe projection before introducing an independent or multi-tenant media worker. Do not send arbitrary media URLs or shell arguments to Agents.
- Local assets are confined by configured roots and realpath checks. Container worker isolation, egress enforcement and nested manifest validation are prerequisites for network media.

Follow-up review should compare the deployed headers, principal changes and worker enrollment against [security architecture](SECURITY_ARCHITECTURE.md).

## P0-003A review

| ID | Severity | Evidence and impact | Remediation | Verification |
|---|---|---|---|---|
| SEC-001 | High | Agent token validation previously checked the signature and station identity only. Re-pairing left older credentials usable and there was no scoped revocation. See [tunnel handshake](../backend/src/infrastructure/agent/agent-ws-server.js#L53). | Check durable per-station generations at handshake. Rotate by transaction on pairing or authorized revoke, invalidate pending codes, audit the mutation and close the registered socket. | Isolated `backend/test/obs-flow.test.js` covers legacy compatibility, old-token rejection, re-pairing and cross-tenant denial. |
| SEC-002 | Medium | An authenticated socket could outlive the token it presented. See the [connection sweep](../backend/src/infrastructure/agent/agent-gateway.js#L88). | Check credential expiry during the existing five-second watchdog. Reject pending commands on disconnect. | `backend/test/agent-liveness.test.js` exercises expiry with a controlled clock value. |
| SEC-003 | Medium | Pairing codes are rate-limited and expire after five minutes, but the installed Windows launchers require a short code format. See [code generation](../backend/src/infrastructure/security/crypto-service.js#L137). | Use a longer one-time enrollment secret once Windows and CLI compatibility can be staged. This slice adds active-code collision protection and checks the issuer's current permissions when claiming. | Format limitation remains open. No guessing or load tests were performed. |
| SEC-004 | Medium | RPC command results previously crossed the trust boundary largely untyped. See [gateway acknowledgement handler](../backend/src/infrastructure/agent/agent-gateway.js#L289). | Validate `COMMAND_ACK` payloads against per-command Zod schemas, strip unapproved fields such as local filesystem paths (`file`, `outputPath`), and reject malformed command results with HTTP 502. | `backend/test/agent-liveness.test.js` and `backend/test/obs-flow.test.js` verify field stripping, malformed result rejection and authorized command flows. |

The review was defensive and scoped to the repository and local test services. MFA, recovery, production HTTPS/WSS, tamper-evident logging, remote media isolation, and actual on-air failover were not verified in this slice.
