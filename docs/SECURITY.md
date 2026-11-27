# Security overview and Phase Zero findings

## Observed controls

Argon2id, separate access/refresh token audiences, DB-backed session checks, HttpOnly strict-same-site cookies, production secure cookies, role middleware, organization-bound station lookups, authenticated Agent pairing and revocation, request and login limits, schema validation, and production Helmet/CORS are present. Media preparation uses fixed argument arrays, controlled temporary directories and input limits. Signed IPTV URLs are scoped to an active Program session and originating user session. These controls were observed in source and selected tests. See [TEST_REPORT.md](TEST_REPORT.md) for coverage.

| Priority | Finding and evidence | Next verification or treatment |
| --- | --- | --- |
| High | Optional Nginx IPTV route publishes a playlist and segments to reachable clients. Temporary IPTV tickets and legacy graphics tokens are carried in URL paths. The application can restrict scope, but reverse proxy request-log redaction has not been verified. | Keep public output off unless explicitly configured and approved. Audit access/CDN logs and referrer handling. Use TLS and test expiration, revocation, sharing controls and range access. |
| High | The Program HTTP ingest URL is host-admin configuration. The worker disables automatic redirects, but equivalent DNS and connection-time destination policy is not established for future UI-managed URLs and import paths. | Specify protocol/destination allowlists and worker egress isolation before accepting remotely managed destinations. Verify with synthetic policies and authorized staging fixtures. |
| High | A media job is capped, but the present preparation/SQLite BLOB path and process-local upload gate are not designed for multi-GB imports, per-tenant byte quotas or multiple workers. | Add durable quota reservations, bounded workers, attachment ownership, staged storage, disk-pressure tests and retention checks before raising the limits. |
| High | One worker is enforced within a supervisor process. No cross-host lease or MySQL-backed durable runtime reconciliation was established. | Keep current single-runtime assumptions. Design locking and fencing and verify recovery before any scale-out. |
| Medium | Several routes aggregate sensitive operations under station control. Account authorization lacks verified reset, self-service credential change and MFA coverage under the new spec. | Build the permission matrix and default-deny tests. Verify cookie mutation origin checks, long-lived realtime revocation and privilege-change behavior. |
| Medium | Docker and deployment templates are present, but deployed least privilege, secrets permissions, TLS and endpoint exposure were not inspected on production. | Review effective runtime configuration in approved staging. Exercise recovery with least-privilege credentials and measure failure handling. |
| Medium | Credential filename matches in Git history were checked. That narrow check cannot detect embedded secrets and does not establish a clean history. | Perform full redacted history and deployment artifact scans, and rotate any verified exposed credential. |

No authentication bypass or production exploit was executed. Findings above are source observations and security gaps to verify. The production dependency advisory check reported zero known issues for the lockfile at audit time. It is not evidence of complete security. See [the threat model](THREAT_MODEL.md) and [security architecture](SECURITY_ARCHITECTURE.md).

## Phase One hardening slice

The backend now prefers backend/.env and retains the root path as a compatibility fallback for existing installations. The checked-in backend/.env.example contains blank secret placeholders. Vite exposes no environment prefixes. The API rejects cross-site mutation requests, suppresses stack traces and sanitizes parser and server failures. The supplied Nginx template disables access logging for token-bearing IPTV playback paths. Existing HLS authorization and audit behavior were retained.

The synthetic frontend configuration probe, both builds, 28 repository tests and the signed HLS/UDP regression passed. A limited Git history and tracked-file pattern search returned no matches for private key blocks or common provider token formats. This search does not certify the full history or replace a dedicated scanner. No credential rotation, deployment, runtime restart or configuration migration was performed.

Remaining: complete repository and history scan, account and role coverage, source destination checks at connection time, ingest rotation and quota controls, and staging verification of TLS, proxy logging, worker/account privilege and egress. Nginx configuration was reviewed in source only. External proxy and platform log policies can differ. Do not deploy or remove legacy configuration support without a validated transition.

To roll back this slice, revert its environment, Vite, HTTP middleware, Nginx and test changes together. Existing secrets and database state require no rollback. Restart only during an authorized maintenance window.

## Phase One media preparation controls

Scene and ad uploads now share one preparation reservation per runtime process. Both handlers recheck the active session, organization role and station ownership before committing prepared media. FFmpeg receives a restricted child environment. Both video preparation paths enforce a 150-second processing budget and a 64 MiB cap on prepared video, frames and PCM, before loading them into SQLite. The upload byte limit and current scene duration limit are unchanged. The reservation does not coordinate across hosts, and the prepared size cap applies after temporary files are generated. Process-level disk quotas and network egress verification remain open.

The build commands succeeded, and the final suite passed 29 tests. The suite checks a concurrent reservation rejection, successful release and privilege downgrade. Separate MP4 and advertising fixtures passed and decoded Program output. Revert the shared reservation, authorization recheck and child environment changes together if rolling back this slice. No migration or production restart is needed to revert the source changes.

## Station media quota and credential findings

Native scene and ad uploads share a station-scoped stored-media budget, default 512 MiB and configurable at startup through MCR_MEDIA_STATION_QUOTA_MIB. Both write paths rely on the same immediate transaction. The check counts existing media, frame and PCM BLOBs and rejects new writes with HTTP 409 if the result would exceed the cap. Existing assets still play. Freeing logical media space allows further uploads. The cap excludes temporary files, SQLite file overhead and host-wide disk consumption. No schema change is needed. To roll back, revert the quota configuration and shared write check together.

A redacted exact-match scan covered 50 reachable Git revisions and tracked working files. The three configured local signing/encryption values matched fallback literals in backend/src/config/env.js. The configured local administrator password matched the legacy password literal in backend/src/index.js. Treat those local values as publicly known. The configured operator seed password did not match. These findings do not establish whether any production installation reused the values, and do not replace full history and artifact scanning.

Do not rotate encryption keys blindly. Back up protected data, inventory encrypted credentials, rehearse decrypt/re-encrypt on a copy, and verify restore. Plan for session invalidation and Agent re-enrollment when rotating signing keys. Change bootstrap configuration and the stored administrator password through an approved maintenance procedure. Verify playback and control before closing the window. No values were printed, no credentials were rotated, and no running service was restarted.

The offline SQLite rekey rehearsal passed using synthetic station credentials and a fresh destination. Actual rotation remains subject to a maintenance window with a verified backup, staged key rotation and explicit cutover approval. [Rekey procedure](OPERATIONS_RUNBOOK.md#offline-station-encryption-rotation-rehearsal)

## Upload throttling and dedicated redacted scan

Both native media upload routes use one process-local budget of 12 attempts per minute per authenticated account, including rejected attempts. Station and role checks run before the limiter. The ad route limits attempts before its binary body parser. Other Program operations do not use this budget. The intended response is HTTP 429 with Retry-After. Restarting the process resets the memory store. Distributed rate limiting remains a future infrastructure requirement.

Gitleaks 8.28.0 was downloaded from its official GitHub release and the Windows archive matched the published SHA-256. Its commit-patch scan reported 42 commits under --all and a single generic API key rule hit in the environment configuration. A separate current-source scan covered 229 tracked or unignored files and reported one hit in the same configuration file. This is complementary to the earlier exact scans of 50 Git snapshots and known local credential values. Rule coverage is not proof that all secrets have been found. The known credentials still require rotation. No cleartext findings are included in the documentation.

The isolated repository suite passed 30 tests with an HTTP rate-budget regression. An independent receiver decoded Program after a valid MP4 upload. To roll back the throttle, remove its middleware from the two upload routes and revert its integration check. It adds no persistent state or schema changes.

## Network credential guard and HTTPS source policy

Network-bound startup rejects the known legacy administrator bootstrap password, use of any of the built-in development key values in another key slot, and reuse between access, refresh and encryption keys. Existing encrypted data and stored verified credentials are not altered by the startup check.

Network-bound HTTPS contribution uses a configured loopback CONNECT proxy, with strict certificate validation, redirects disabled and HTTP request logging disabled in the GStreamer source. The optional single-source sidecar checks the configured authority, resolves IPv4 per connection and dials an approved numeric address. Integration tests used a synthetic DNS source and loopback sockets. No direct production DNS, firewall, SRT or alternate proxy behavior was tested. Follow the [deployment procedure](DEPLOYMENT.md#phase-one-https-contribution-egress) for isolation and staging probes.

Both builds and 34 suite tests passed. The local HTTP contribution, rejecting HTTPS proxy and signed HLS regressions passed, including UDP continuity during HLS failure. Roll back the supervisor, worker and proxy configuration together in a maintenance window if needed. Keep the private credentials in place when rolling application code back. There is no database migration.

## Phase One browser mutation origin policy

The primary Express API and separate Program runtime now enforce the same origin policy on writes. A request carrying a session cookie must carry an allowed Origin or same-origin browser metadata. The proxy preserves origin metadata for write requests. The existing same-host fallback remains available only in loopback development. Bearer-only API clients without browser headers remain supported. GET, HEAD and OPTIONS retain their prior proxy behavior, including signed HLS playlist and segment delivery.

Rollback reverts the shared middleware, the runtime forwarding change and their corresponding tests as one change. This adds no schema or credential migration. Verify approved production proxy and browser behavior in staging before deploying.

## Phase One browser session token isolation

Login and refresh deliver session tokens to browser and cookie-based clients through HttpOnly cookies. The API retains the JSON access token for programmatic requests that carry neither `Origin` nor `Sec-Fetch-Site` nor a session cookie. Authentication responses handled by the auth router carry `Cache-Control: no-store`.

Rollback reverts the login and refresh response filtering, restores the original cache header in the session cookie helper and reverts the corresponding integration assertions together. No schema or credential migration is required.

## Phase One request body rejection

The shared HTTP error handler returns a generic message for HTTP 415 responses. The primary API integration covers the default 100 KiB JSON limit, malformed JSON, unsupported request encoding and subsequent valid authentication. Rollback reverts the HTTP 415 message mapping and its integration assertions together. Body size limits and database schema are unaffected.

## Phase One audit log read limits

The authenticated audit log API validates a single positive integer limit of at most 500 and defaults to 100 when omitted. The repository applies the validated limit and authenticated organization ID as SQL parameters. This bounds the result size and the number of event details decoded per response. Rollback reverts the controller validation and corresponding integration assertions. No database migration is required.

## Phase One account creation audit

The existing administrative user creation endpoint records `USER_CREATED` in the same SQLite transaction as the new account. The event identifies the authenticated actor, organization, target account, assigned role and request IP. The event excludes the account password, hash and email. A failed event insert rolls back the account insert. Rollback reverts the route's audit actor argument, the repository transaction and its integration assertions. Existing audit events are retained and no schema migration is required.

## Phase One CORS response policy

REST and Socket.IO emit `Access-Control-Allow-Origin` only for the exact configured origin. Responses handled by the CORS middleware vary by `Origin`. Same-origin and originless clients continue through the existing authentication and mutation-origin policies. Rollback reverts the REST and Socket.IO CORS option changes with their integration assertions. No environment or database change is required. Effective production proxy headers and TLS remain subject to the staging gate.

## Phase One production content security policy

The production server restricts stylesheet files and fonts to same-origin resources and the two Google Fonts hosts referenced by the dashboard. Inline styles remain enabled for existing dynamic layouts. Scripts and media load from the same origin. Connection policy allows same-origin requests and the secure WebSocket endpoint derived from `CORS_ORIGIN`. Helmet continues to provide the other production directives and response headers.

Rollback reverts the production CSP directive overrides and their integration test. Staging acceptance still requires a browser check of login, live media and the Socket.IO connection through the effective HTTPS proxy.

## Phase One inbound HTTP deadlines

The main API and loopback Program server share a 30-second header deadline, a five-minute deadline to receive the complete request, and a five-second interval for checking those deadlines. These are Node HTTP receive settings. They are separate from response streaming, media processing and the existing Program proxy timeout. Rollback restores default Node HTTP server options in both entry points and removes the deadline assertions. Check effective ingress timeouts and representative upload rates in staging.

## Phase One ad upload admission

The ad route validates the upload name and media type, checks library capacity and acquires the process-wide media reservation before buffering a supported body. The reservation covers parsing, preparation and persistence and is released on errors and success. Native scene and advertising uploads continue to share the reservation. Rollback restores the ad parser as route middleware and the preparation-only reservation on that route, and reverts the related integration assertions. No data migration is required.

## Phase One frontend build artifact audit

The frontend test scans regular files beneath the production output directory, including nested public assets, for known secret patterns and published source maps or references. Its optional `MCR_BUNDLE_AUDIT_CANARY` is a synthetic exact-match value supplied during verification. Failures report the file and category. The audit covers the local build and the defined patterns. It cannot attest to arbitrary secret formats or separately deployed files. Rollback reverts the expanded test to its previous JavaScript-only scan. This verification change has no runtime or data migration.

## Phase One station list filter validation

The station list validates `status` and `streamStatus` against the shared status enums before querying the repository. The API returns a generic 400 for an invalid filter. The SQLite query binds validated filter values and the authenticated organization ID as parameters. Rollback reverts the validation schema, controller integration and related tests together. No schema or data migration is required.

## Phase One station studio organization scope

The active SQLite station repository checks ownership on a new or changed studio assignment. Missing and foreign studios get the same 404 response. The check and station write run synchronously on the same connection. Existing assignments are retained when updating other fields. `null` clears a link. Rollback reverts the repository check and its integration assertions. No migration or repair of existing references was performed.

## Phase One independent login and pairing limits

Login and Agent pairing claim each have a separate in-process, per-IP request counter. Each allows ten attempts per 15-minute window. The login account limit and the general API rate limit remain in effect. Real client IP attribution through the deployment proxy and behavior across instances require staging verification. Rollback restores the shared limiter and reverts the isolation assertions. No data change is required.

## Phase One administrative response and write policy

The users and audit routes set `Cache-Control: no-store` before authentication so policy applies to the route's successful and denied responses. Account creation validates a strict payload and derives organization ownership from the authenticated caller. The user list continues to select public account fields and to filter by the caller's organization. Rollback restores the auth-only cache middleware scope and the previous account creation schema with their corresponding tests. No data migration is required.

## Phase One refresh request validation

The refresh endpoint validates the cookie or JSON token as a string of 1 to 4,096 characters before JWT verification. The programmatic JSON body accepts only the `refreshToken` field. The browser cookie remains the primary credential when supplied. Invalid explicit input returns 401 with a generic response and leaves session state unchanged. Rollback restores the previous extraction and schema with the related integration assertions. No database migration is required.

## Phase One REST role checks

The shared REST permission check denies roles absent from the role table before checking permissions. The loopback matrix covers the station read, station management, station control, user management and audit read gates. The write checks stop at request validation and send no media or OBS command. Rollback reverts the role-table guard and its matrix assertions. No migration is needed.

## Phase One dashboard socket authorization

The Socket.IO gateway uses the shared `station:read` permission check during authentication before joining an organization room. Station subscriptions continue to check the station against the authenticated organization. Session revocation disconnects the socket. Rollback reverts the handshake permission check, restores the previous subscription permission check and reverts the socket integration assertions. No migration is needed.

## Phase One HLS response privacy

The HLS router sets `Cache-Control: private, no-store` and `Referrer-Policy: no-referrer` before playback authorization. The internal Program proxy forwards both headers. Verify that external ingress preserves the same headers and suppresses signed playback URLs in access logs. Rollback restores the controller-level response headers and reverts the proxy allowlist and fixture assertions. No database change is required.

## Phase One station write schemas

Station creation and settings updates validate a strict field list before calling the repository. The existing UI sends supported fields. API clients that send full station objects need to select writable fields. Rollback restores the previous unknown-field stripping behavior and reverts the related integration assertions. No migration is required.

## Phase One login request bounds

Login accepts only the email and password fields. The schema caps the submitted password at 4,096 characters before account lookup and password verification. This ceiling exceeds the 128-character limit on the administrative account-creation route. Rollback reverts the stricter login schema and the integration assertions. No credential or schema migration is required.

## Phase One CSV export text handling

The audit and Program schedule exports share a cell formatter. It surrounds cells with quotes, doubles embedded quotes and prefixes text with an apostrophe when its first normalized character is whitespace or a spreadsheet marker. The normalization is used only for the check and the exported value keeps its original characters. Rollback restores the prior export formatters and removes the shared formatter and its tests. Spreadsheet import behavior requires separate client verification.

## Phase One temporary media cleanup

Scene and ad video preparation create the source file exclusively with POSIX mode `0600` where supported. Cleanup retries transient removal errors up to three times in the preparation directory created for that request. The Windows fixture checks removal after decoding rejects a file and after a successful upload. Check the media service temp directory ACL separately on Windows. Rollback reverts the explicit creation modes, cleanup retry options and their fixture additions. No database migration is required.

## Phase One scheduled automation organization scope

Before dispatch, the worker checks that the creator is active, currently belongs to the stored job organization, and still has scheduling permission. Rejected jobs enter the existing failed status and audit path. Rollback reverts the organization check, the shared permission helper adoption and the corresponding fixture assertions. No migration is required.

## Phase One manual automation audit

Manual runs record the authenticated operator as the audit actor. Scheduled runs continue to record the schedule creator, and job records retain their creator. Rollback reverts the actor argument and corresponding integration assertions. Existing events are retained and no database migration is required.

## Phase One automation cancellation audit

An authorized cancellation changes the pending job and adds its organization-scoped `AUTOMATION_CANCELLED` event in a single SQLite transaction. The event identifies the authenticated actor, station and automation. The existing conflict response covers requests that cannot change a pending job. If the audit insert fails, the transaction rolls back. Rollback restores the previous cancellation update and removes the corresponding integration assertions. Existing events are retained and no migration is required.

## Phase One automation creation audit

Creating a macro or scheduled job commits the new job and its `AUTOMATION_CREATED` event in the same transaction. The event records the actor, organization, station, job ID and whether the job is manual or scheduled. It omits job names, scene names and command payloads. An audit insert failure leaves no job. Rollback restores the previous creation write while keeping transactional cancellation and existing events. No migration is required.

## Phase One proxy trust validation

The primary API supports explicit trusted ingress addresses through `MCR_TRUST_PROXY_CIDRS`. Startup validation rejects invalid addresses, hostnames and zero-prefix CIDRs without echoing the configured entries. Startup preserves the prior single-hop or disabled policy when the list is empty. Local tests exercise Express's compiled address check. Effective client IP attribution still depends on the deployed proxy chain. [Deployment and rollback](DEPLOYMENT.md#phase-one-explicit-proxy-trust)

## Phase One local staging boundary

The staging fixture verifies the production entry point on isolated SQLite through a local TLS reverse proxy. It does not use production keys, a persistent browser profile or a live Agent or OBS station. The storage guard prevents an unsupported MySQL or unknown mode from silently starting against SQLite. Rollback removes the storage guard and its startup assertions together. No schema or data migration is required. Deployment approval still requires the gates for credential rotation, dependency advisories, actual reverse proxy behavior, log redaction and runtime privilege. [Local staging](DEPLOYMENT.md#phase-one-local-staging)

The server Dockerfile does not set a runtime `USER`. The effective account, existing persistent-volume permissions and migration to least privilege need validation together on a clean container host and a representative restored volume. A portable OBS copy isolates its profile, while the OBS WebSocket listen behavior requires separate network isolation. [OBS WebSocket listener implementation](https://github.com/obsproject/obs-websocket/blob/master/src/websocketserver/WebSocketServer.cpp)

## Post-audit remediation boundaries

The Program audio monitor now bounds the open stream by access-token expiry and rechecks session, role, organization and station membership. The client can reconnect after obtaining current credentials. This protects the monitoring path without stopping the Program output.

The Windows Agent protects newly written credentials with current-user DPAPI and migrates readable legacy files atomically on load. Linux restricts the directory to 0700 and the credential file to 0600 and requires matching ownership. Use a dedicated account. Changing Windows service accounts requires pairing again. Do not move a DPAPI file between accounts or machines. Validate effective Windows ACL and Linux service privileges separately on staging. Existing backups and prior plaintext copies enter the credential rotation review.

The optional Compose overlay denies the old static IPTV root and removes its web mount. Use the station-authorized HLS route or scoped signed playback link. Stable external provider grants remain planned. Existing graphics URLs continue until explicit rotation or revocation. New and rotated URLs expire after 90 days. Configure the new URL in the overlay client when rotating. Nginx suppresses request logs in locations containing bearer-style links. Verify sanitized logging at the outer proxy, application platform and redirect layer too.

Private UDP ingest requires an explicit trusted-network opt-in, an assigned private address and a firewall rule restricting senders. UDP still provides no sender authentication. Use an authenticated, encrypted and separately accepted contribution path where the network cannot be trusted. Managed network URLs continue to use the loopback egress proxy with an approved public IPv4 destination. The current runtime does not enable direct RTSP, RTMP or SRT camera ingest. Qualify each protocol and nested manifest request before enabling it. Existing SRT receiver evidence covers output.

See [release gates](SECURITY_RELEASE_GATES.md) for credential rotation, external audit approval and deployment sign-off. Roll back the audio change by reverting the middleware and monitor controller together. Keep the static IPTV deny rule during rollback. Retain the additive graphics column and verify any legacy release honors the revocation and expiration policy before repointing public traffic. A Windows Agent downgrade does not read the protected credential format. Re-pair under an approved rollback if required.
### Nginx gateway verification

Keep the browser-overlay page inside the log-suppressed Nginx location when serving the application index. Explicitly forward the nested signed HLS and video upload locations to the API. A disposable Windows Nginx run tested these paths and checked log redaction during upstream failure. Re-run the fixture after gateway changes and repeat the deployed log checks in authorized Linux staging. [Verification](TEST_REPORT.md#actual-nginx-ingress-on-windows-loopback)
### Retiring inherited development defaults

The source uses random fallback keys for a single local process. Configure stable per-installation keys outside Git for persistent development data or split processes. If a local database was encrypted using a previous default, first back it up and rehearse rekeying a copy with the old key supplied from the local configuration. Network-bound startup rejects the known exposed values and requires three distinct configured keys.

Network-bound login rejects the exposed bootstrap password for the original administrator. An authorized operator can migrate that account by configuring a new `MCR_ADMIN_PASSWORD` and supplying `MCR_PREVIOUS_ADMIN_PASSWORD` from protected configuration for one startup. The migration requires the previous password to match both the known legacy verifier and the stored account hash. Remove the temporary reference after verifying the new login. This source change does not rotate any credentials or rewrite historical commits.
## Phase Two accounts and authentication

Account settings can change the signed-in user's display name, change the password after reauthentication, and list or revoke the user's own active sessions. Session responses include only the session identifier, expiration and current-session marker. The SQLite transaction keeps each account change and its audit event together. Password changes revoke all existing sessions. Account administrators can change status or assign an existing managed role in their own organization after reauthentication. These actions cannot target the caller or assign or modify administrator roles through the managed account endpoints. Status and role changes revoke affected sessions. The API signals local WebSocket disconnection after commit. Other processes use the shared SQLite session state for subsequent authorization.

Account creation rechecks the administrator's active session, current user-management permission, tenant and assignable role inside the same SQLite write transaction as the account insert and audit event. This check runs after password hashing. An existing normalized email returns a conflict and leaves the account and audit log unchanged.

Login continues using Argon2id. A process-local dummy hash supplies password verification work for unknown and inactive users. The password and account state are rechecked within the session issuance transaction. The login audit, second-factor consumption and session creation are committed together.

Password recovery is disabled until both `MCR_PASSWORD_RESET_DELIVERY_URL` and `MCR_PASSWORD_RESET_DELIVERY_KEY` are configured. The receiving service must listen on an explicit numeric loopback port and accept an authenticated JSON POST with `email` and `resetUrl`. Keep it off the public network and exclude its payloads and credentials from logs. It is responsible for actual mail delivery using an approved sender. The API responds generically and applies per-IP and per-address limits. It uses the configured application origin and puts the reset token in the URL fragment. SQLite stores only a SHA-256 digest with a 15-minute lifetime. A successful reset consumes the grant, audits the action and revokes previous sessions in one transaction. Deactivation and password replacement invalidate outstanding grants. Password reset preserves any enrolled second factor.

Optional two-factor authentication uses a 30-second TOTP step and accepts the current or previous step. An accepted step cannot be reused. Enrollment requires current-password verification and expires after ten minutes. Eight randomly generated recovery codes are shown once and stored only as digests. Each code can be consumed once. Enabling or disabling MFA revokes previous sessions. Factor secrets are encrypted with the configured master key. The existing SQLite rekey command rotates station credentials and active or pending factor secrets on the verified copy. [RFC 6238](https://www.rfc-editor.org/rfc/rfc6238.html)

The API enforces separate permissions for current emergency switching, audio changes, video-scene configuration, media upload and deletion, ad management, graphics, schedule publication and IPTV link management. Existing roles retain their effective rights for these operations. Schedule editing, station status viewing, live control, audit access and user administration retain their existing permission names. Full system settings and future resource-management endpoints require permission assignments when implemented.

For rollback, restore the matching frontend and server version together or use a forward fix. An older server does not enforce enrolled MFA. Do not deploy such a downgrade for active MFA accounts unless affected access is suspended and an authorized recovery procedure is in place. Preserve the encrypted database and its corresponding key in protected backup storage. The additive tables and index may stay in place. Disable delivery at the configured loopback service if recovery must be suspended. [Verification](TEST_REPORT.md#phase-two-local-account-verification)
