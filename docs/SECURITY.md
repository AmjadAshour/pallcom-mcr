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

### Phase One OBS control ownership and Agent RPC result schemas

The OBS audio volume, audio mute and studio-mode transition endpoints verify that the target station belongs to the authenticated caller's organization before dispatching a command to the station Agent, returning HTTP 404 for foreign or missing stations and recording organization-scoped `AUDIO_VOLUME_UPDATED`, `AUDIO_MUTE_UPDATED` and `TriggerStudioModeTransition` audit events. OBS control, automation creation, playout plan/health/control and legacy graphics write schemas reject undeclared fields with HTTP 400, and volume updates require at least one volume parameter (`inputVolumeMul` or `inputVolumeDb`).

Legacy graphics mutations (`GRAPHICS_OVERLAY_SAVED`, `GRAPHICS_OVERLAY_PUBLISHED`, `GRAPHICS_OVERLAY_HIDDEN`, `GRAPHICS_OVERLAY_DELETED`, `GRAPHICS_LINK_ROTATED`, `GRAPHICS_LINK_REVOKED`), station lifecycle mutations (`STATION_CREATED`, `STATION_UPDATED`, `STATION_DELETED` with dependent Program schedule, scene, audio and selection cleanup), and native Program scene and schedule mutations (`PROGRAM_SCENE_SAVED`, `PROGRAM_SCHEDULE_HOLD`, `PROGRAM_SCHEDULE_CREATED`, `PROGRAM_SCHEDULE_RESCHEDULED`, `PROGRAM_SCHEDULE_CANCELLED`, `PROGRAM_SCHEDULE_LIST_CREATED`) commit their state change and organization-scoped audit event in the same SQLite transaction. Playout plan saves, media scans, playout controls and signed IPTV playback-link issuance (`PLAYOUT_PLAN_SAVED`, `PLAYOUT_MEDIA_SCANNED`, `PLAYOUT_CONTROL`, `PROGRAM_PLAYBACK_LINK_ISSUED`) also record organization-scoped audit events. The Electron desktop IPC handler forwards the validated dashboard origin on non-GET requests and permits `PUT` mutations alongside `GET`, `POST`, `PATCH` and `DELETE`.

The Agent gateway validates `COMMAND_ACK` results against per-command schemas before resolving pending RPC promises. Unapproved host fields such as local filesystem paths (`file`, `outputPath`) are stripped, and malformed or unrecognized command results are rejected with HTTP 502. In addition, `programInputConfig` and `createProgramEgressProxy` reject non-public HTTPS source hostnames (`localhost`, `.local`, `.internal`, IPv6 literals, and private, loopback, link-local/cloud-metadata `169.254.0.0/16`, CGNAT or multicast IPv4 literals) at configuration time as well as connection time, and Vite production builds explicitly set `build.sourcemap: false`. Rollback reverts the controller and route audit/schema checks, gateway result schemas, destination hostname checks, Vite config option and their regression tests together. No database migration is required.
## Phase Two accounts and authentication

Account settings can change the signed-in user's display name, change the password after reauthentication, and list or revoke the user's own active sessions. Session responses include only the session identifier, expiration and current-session marker. The SQLite transaction keeps each account change and its audit event together. Password changes revoke all existing sessions. Account administrators can change status or assign an existing managed role in their own organization after reauthentication. These actions cannot target the caller or assign or modify administrator roles through the managed account endpoints. Status and role changes revoke affected sessions. The API signals local WebSocket disconnection after commit. Other processes use the shared SQLite session state for subsequent authorization.

Account creation (`POST /api/v1/users`) requires `user:manage`, applies the sensitive account-change rate limiter, verifies the administrator's `currentPassword` before hashing the new user's password, and rechecks the administrator's active session, current user-management permission, current password hash, tenant and assignable role inside the same SQLite write transaction as the account insert and `USER_CREATED` audit event. An existing normalized email returns a conflict and leaves the account and audit log unchanged.

Login continues using Argon2id. A process-local dummy hash supplies password verification work for unknown and inactive users. Failed login attempts against an existing deactivated account record an organization-scoped `LOGIN_FAILED` audit event (`reason: 'Account inactive'`) while returning the same generic `401 Invalid email or password` response as unknown accounts or wrong passwords. The password and account state are rechecked within the session issuance transaction. The login audit, second-factor consumption and session creation are committed together.

Password recovery is disabled until both `MCR_PASSWORD_RESET_DELIVERY_URL` and `MCR_PASSWORD_RESET_DELIVERY_KEY` are configured. The receiving service must listen on an explicit numeric loopback port and accept an authenticated JSON POST with `email` and `resetUrl`. Keep it off the public network and exclude its payloads and credentials from logs. It is responsible for actual mail delivery using an approved sender. The API responds generically and applies per-IP and per-address limits. It uses the configured application origin and puts the reset token in the URL fragment. SQLite stores only a SHA-256 digest with a 15-minute lifetime. A successful reset consumes the grant, audits the action and revokes previous sessions in one transaction. Deactivation and password replacement invalidate outstanding grants. Password reset preserves any enrolled second factor.

Optional two-factor authentication uses a 30-second TOTP step and accepts the current or previous step. An accepted step cannot be reused. Enrollment requires current-password verification and expires after ten minutes. Eight randomly generated recovery codes are shown once and stored only as digests. Each code can be consumed once. Enabling or disabling MFA revokes previous sessions. Factor secrets are encrypted with the configured master key. The existing SQLite rekey command rotates station credentials and active or pending factor secrets on the verified copy. [RFC 6238](https://www.rfc-editor.org/rfc/rfc6238.html)

The API enforces separate permissions for current emergency switching, audio changes, video-scene configuration, media upload and deletion, ad management, graphics, schedule publication and IPTV link management. Existing roles retain their effective rights for these operations. Schedule editing, station status viewing, live control, audit access and user administration retain their existing permission names. Full system settings and future resource-management endpoints require permission assignments when implemented.

For rollback, restore the matching frontend and server version together or use a forward fix. An older server does not enforce enrolled MFA. Do not deploy such a downgrade for active MFA accounts unless affected access is suspended and an authorized recovery procedure is in place. Preserve the encrypted database and its corresponding key in protected backup storage. The additive tables and index may stay in place. Disable delivery at the configured loopback service if recovery must be suspended. [Verification](TEST_REPORT.md#phase-two-local-account-verification)

## Phase Three media library and resumable uploads

The centralized Media Library (`/api/v1/media/*`) enforces authentication, organization isolation and granular RBAC (`station:read` for viewing/previews, `media:upload` for uploads/imports/metadata/playlists, and `media:delete` for asset/playlist deletion and orphan cleanup). All responses carry `Cache-Control: private, no-store` and `Referrer-Policy: no-referrer`.

1. **Storage Isolation, Path Traversal and Symlink Defenses**:
   - Media binaries, staging `.part` files, JPEG thumbnails and quarantined payloads reside outside the database and outside `frontend/dist` under `MCR_MEDIA_STORAGE_ROOT` (`media`, `uploads`, `thumbnails`, `processing`, `quarantine`).
   - User-supplied filenames are sanitized for display metadata only (`sanitizeDisplayFilename`) and are never used to construct filesystem paths. Storage keys use validated organization slugs and UUIDs (`^(media|uploads|thumbnails|processing|quarantine)\/[a-zA-Z0-9_-]{1,80}\/[a-f0-9-]{36}\.(bin|part|jpg|png|mp4|m4a)$`).
   - Every read, write, promotion and server-directory import verifies strict path prefix containment and inspects `lstat()` (`verifyNoSymlink`) to reject symbolic links and directory traversal (`../`, `..\\`, absolute paths, null bytes).
2. **Resumable Chunk Streaming, Quota Reservation and Disk Headroom**:
   - Session initiation atomically reserves `expectedSizeBytes` against `MCR_MEDIA_ORG_QUOTA_MIB` (default 500 GiB) in a `BEGIN IMMEDIATE` transaction after expiring abandoned sessions (`MCR_MEDIA_UPLOAD_TTL_MINUTES`) and checking free disk headroom (`MCR_MEDIA_MIN_FREE_DISK_MIB`, returning HTTP 507 when below threshold).
   - Chunk transfers (`PATCH /api/v1/media/uploads/:id`) enforce per-session locks and a process-wide concurrent stream limit (`MCR_MEDIA_MAX_CONCURRENT_UPLOADS`), verify `Upload-Offset` against the physical `.part` file size on disk (returning HTTP 409 with the authoritative `Upload-Offset` on duplicate or out-of-order chunks), stream directly to disk without buffering multi-gigabyte files in Node.js memory, and support optional per-chunk and mandatory final SHA-256 integrity checks.
3. **Magic-Byte Inspection, Subprocess Safety and Quarantine**:
   - `media-processor.js` inspects actual magic-byte container signatures (`sniffMagicSignature`) before invoking `ffprobe` or `ffmpeg` via `execFile` with fixed argument arrays, sanitized child environment variables, `-threads 1`, and bounded timeouts (`MCR_MEDIA_PROCESSING_TIMEOUT_MS`).
   - Spoofed files (such as an executable renamed `.mp4`) or category/codec mismatches are moved to `quarantine/<orgId>/<assetUuid>.bin`, marked `QUARANTINED` (`UNSUPPORTED`), and denied preview or playlist inclusion. Corrupted containers that fail a 1-second FFmpeg null-mux decode check are marked `FAILED`.
4. **Controlled Server Directory and SSRF-Protected URL Imports**:
   - Server-directory import (`POST /api/v1/media/import/directory`) is confined strictly to `MCR_MEDIA_IMPORT_DIR` and rejects relative path traversal and symbolic links.
   - Direct URL import (`POST /api/v1/media/import/url`) requires HTTPS, rejects credentials/fragments, denies HTTP redirects (`3xx`), and validates both the hostname (`isPublicSourceHostname`) and resolved IPv4 addresses (`isPublicIPv4`) at connection time via a custom `lookup` callback to prevent DNS rebinding and SSRF against loopback, private RFC1918, link-local/cloud-metadata (`169.254.0.0/16`), CGNAT and multicast ranges.
5. **Reference-Locked Deletion and Audit Logging**:
   - `DELETE /api/v1/media/assets/:id` requires explicit confirmation (`?confirm=true`), checks active Program broadcast usage, pending schedules, saved scenes, advertisement placements, playout plans and media playlists (`inspectAssetReferences`), blocks deletion of referenced or actively processing assets with HTTP 409, and records `MEDIA_ASSET_DELETED` in the same transaction as the metadata removal before unlinking files.
6. **Rollback**:
   - Revert the `/api/v1/media` router mount, `MediaLibraryPage.jsx`, and the `IMediaRepository` wiring together. Existing legacy scene/ad uploads and additive tables require no destructive rollback. [Architecture and Linux deployment](MEDIA_LIBRARY_ARCHITECTURE.md)

## Phase Four video source management and Phase 15 MySQL persistence controls

The unified Video Source API (`/api/v1/video-sources*`) requires authentication, organization scope, `station:read` for viewing/previews, and `video:manage` for source registration, updates, health probing and confirmed deletion (`?confirm=true`). All responses carry `Cache-Control: private, no-store` and `Referrer-Policy: no-referrer`.

1. **Protocol Allowlists, SSRF Defense and DRM Prohibition**:
   - `validateVideoSourceUrl` (`backend/src/infrastructure/sources/video-source-service.js`) enforces strict per-type protocol schemes (`https:` for `HLS_STREAM` and `REMOTE_VIDEO_URL`, `rtmp:`/`rtmps:` for `RTMP_STREAM`, `srt:` in `caller` mode with an explicit port `1024`â€“`65535` for `SRT_STREAM`, and `rtsp:`/`rtsps:` for `RTSP_STREAM`).
   - URLs containing embedded credentials (`username`/`password`), fragments, DRM manifest markers (`widevine`, `playready`, `fairplay`, `drm`, `.key`), non-public hostnames (`localhost`, `.local`, `.internal`, IPv6 literals) or private/loopback/link-local/cloud-metadata (`169.254.0.0/16`)/CGNAT/multicast IPv4 addresses are rejected at both configuration time and connection/probe time.
   - `SERVER_FILE` sources are confined strictly to `MCR_MEDIA_IMPORT_DIR` via `mediaStorage.resolveImportSource`, rejecting path traversal and symbolic links.
2. **Credential Encryption at Rest**:
   - Optional stream secrets (RTMP stream keys, SRT passphrases, RTSP tokens) are encrypted with AES-256-GCM (`CryptoService.encryptSecret`) before storage in `video_sources.encryptedSecret`. API responses expose only `hasSecret: true/false` and never return plaintext or ciphertext secrets.
3. **Bounded Health Probing, Reconnection Backoff and Fallback Protection**:
   - `POST /api/v1/video-sources/:id/probe` re-validates destination URLs against DNS rebinding before running `ffprobe` via `execFile` with fixed argument arrays, sanitized child environment variables and a 15-second timeout.
   - Probe failures increment `retryCount`, compute bounded exponential backoff (`computeReconnectBackoffMs`), sanitize local filesystem paths from error messages, transition the source from `RECONNECTING` (`UNAVAILABLE`) to `ERROR` (`FALLBACK_ACTIVE`) once `maxRetries` is reached, and reset `retryCount` to `0` (`ONLINE`/`AVAILABLE`) upon recovery.
   - Media assets referenced by a video source (`mediaAssetId` or `fallbackAssetId`) cannot be deleted from the Media Library (`409 VIDEO_SOURCE_REFERENCE`), and a video source configured as another source's `fallbackSourceId` cannot be deleted until unassigned.
4. **Protocol-Specific Limitations and Rollback**:
   - Direct browser preview plays validated file/movie/playlist assets and renders JPEG thumbnails; external `RTMP`, `SRT` and `RTSP` live streams are inspected server-side by `ffprobe` and require the server-side GStreamer/FFmpeg channel worker (Phase 06) for continuous live transcoding to browser HLS.
   - To roll back Phase Four and the Phase 15 MySQL repositories, revert the `/api/v1/video-sources` router mount, `VideoSourcesCatalog.jsx`, `video-source-service.js`, and the Prisma repository adapters. Existing SQLite data and external media files remain intact.


## Phase Five independent audio sources and multi-track mixer controls

The Channel Audio & Mixer API (`/api/v1/channels/:channelId/audio*`) enforces authentication, organization ownership of `:channelId` (returning HTTP 404 for foreign channels), `station:read` for viewing mixer/source state, and `audio:manage` for all source, mixer, probe, and microphone mutations. All responses carry `Cache-Control: private, no-store` and `Referrer-Policy: no-referrer`.

1. **Radio Stream SSRF Defense and Credential Encryption at Rest**:
   - `validateRadioStreamUrl` (`backend/src/infrastructure/audio/audio-mixer-engine.js`) permits only `http:` and `https:` schemes, rejects embedded credentials (`username`/`password`) and URL fragments, validates public hostnames (`isPublicSourceHostname`), and resolves IPv4 addresses (`isPublicIPv4`) to block loopback, RFC1918 private networks, link-local/cloud-metadata (`169.254.0.0/16`), CGNAT, and multicast destinations.
   - Optional radio authentication tokens (`secret`) are encrypted at rest with AES-256-GCM (`CryptoService.encryptSecret`) in `audio_sources.encryptedSecret`. API responses expose only `hasSecret: true/false` and never return plaintext or ciphertext secrets.
2. **Explicit Session-Bound Microphone Authorization**:
   - `MICROPHONE_INPUT` sources are created in the `PAUSED` state and never capture or broadcast audio automatically.
   - Activation (`POST /api/v1/channels/:channelId/audio/sources/:id/microphone` with `action: 'activate'`) requires an active session with live `audio:manage` permission (`hasCurrentPermission`), records `MICROPHONE_ACTIVATED` in the audit log, and binds the microphone session in memory to `userId`, `sessionId`, and the access token's `expiresAt` deadline.
   - Pushing PCM audio (`POST /microphone/pcm`) without prior activation returns HTTP `409`. Any attempt by a different operator, a revoked session, or an expired token immediately terminates the microphone session and returns HTTP `401`/`403`.
3. **Monitoring-Only Solo Isolation & Soft-Knee Peak Limiting**:
   - `soloMonitoring` is evaluated exclusively on the `monitorMix` bus (`monitoringSoloOnly: true`) and ignored on `broadcastMix` (`monitoringSoloOnly: false`), ensuring an operator testing a source in headphones can never accidentally mute the live on-air broadcast mix.
   - Master output samples pass through a soft-knee peak limiter bounded at `peakLimiterCeilingDbfs` (default `-1.0 dBFS`) to prevent digital clipping when multiple sources sum together.
4. **Reference-Locked Media and Fallback Protection & Rollback**:
   - Media assets referenced by an audio source (`mediaAssetId` or `fallbackAssetId`) cannot be deleted from the Media Library (`409 AUDIO_SOURCE_REFERENCE`), and an audio source configured as a fallback (`fallbackSourceId`) cannot be deleted until unassigned.
   - To roll back Phase Five, revert `/api/v1/channels/:channelId/audio*` (`backend/src/presentation/routes/audio.js`), `backend/src/infrastructure/audio/audio-mixer-engine.js`, the external PCM bridge in `worker.py`/`supervisor.js`, and `frontend/src/pages/AudioMixerPage.jsx`. Additive database tables (`audio_sources`, `audio_mixer_configs`) and existing Program audio controls remain intact. See [AUDIO_ARCHITECTURE.md](AUDIO_ARCHITECTURE.md).


## Phase Six server-side multi-channel playout security controls

The Channel Playout API (`/api/v1/channels/:channelId/playout*`) enforces authentication, organization ownership of `:channelId` (returning HTTP 404 for foreign channels), `station:read` for viewing runtime snapshots and monitor frames, `station:manage` for structural configuration updates (`PATCH /playout/config`), `station:control` for lifecycle (`start`, `stop`, `restart`), camera switching/exclusion, and movie queue controls, and `broadcast:emergency` for emergency broadcast overrides (`POST /playout/emergency`). All responses carry `Cache-Control: private, no-store` and `Referrer-Policy: no-referrer`.

1. **Controlled Camera Network & VPN Allowlist vs. SSRF Protection**:
   - `validateCameraDestinationWithAllowlist` (`backend/src/infrastructure/playout/channel-playout-supervisor.js`) unconditionally denies `localhost`, `127.0.0.0/8`, `0.0.0.0`, embedded URL credentials, and cloud metadata (`169.254.0.0/16`) even if an administrator attempts to add them to `networkAllowlist`.
   - Non-public camera network destinations (such as dedicated WireGuard or private camera VLAN endpoints) are denied by default (`400`) unless their exact `host` and `port` match an authorized entry in the channel's `networkAllowlist`.
2. **Circular Fallback Rejection, Revision Locking & Active Media Deletion Protection**:
   - `validateFallbackHierarchy` inspects fallback chains and rejects self-referential or circular fallback configurations with HTTP `400`.
   - `saveChannelConfig` enforces optimistic concurrency when `expectedRevision` is supplied (`409 Conflict`).
   - Media assets actively playing or queued in a channel's `ChannelPlayoutConfig` (`currentMediaAssetId`, `movieQueue`, `fallbackConfig`, `adSchedulePolicy`) are protected from deletion in both `SqliteMediaRepository` and `PrismaMediaRepository` (`409 ACTIVE_BROADCAST`, `CHANNEL_PLAYOUT_REFERENCE`).
3. **Resource Admission Controls & Subprocess Isolation**:
   - `MultiChannelPlayoutSupervisor.assertResourceAdmission` enforces `MCR_MAX_CONCURRENT_CHANNELS` (default `4`) and `MCR_MIN_FREE_MEMORY_MB` (default `256 MB`), returning HTTP `503` before spawning a new Full HD GStreamer worker if server resources would be exhausted.
   - `channel-worker.py` is spawned with fixed argument arrays and a sanitized child environment (`sanitizedChildEnv`) without passing application secrets or database credentials.
4. **Rollback**:
   - Revert `/api/v1/channels/:channelId/playout*` (`backend/src/presentation/routes/channel-playout.js`), `backend/src/infrastructure/playout/channel-playout-supervisor.js`, `backend/src/infrastructure/playout/channel-worker.py`, and `frontend/src/components/ChannelPlayoutConsole.jsx`. Additive database tables (`channel_playout_configs`) and the legacy single-station `IndependentProgram` path remain intact. See [PLAYOUT_ENGINE_ARCHITECTURE.md](PLAYOUT_ENGINE_ARCHITECTURE.md).

## Phase Seven — Broadcast Scheduler Security Controls

- **Granular RBAC Enforcement:** `station:read` (view schedule, As-Run, EPG), `schedule:manage` (edit/validate draft), `schedule:publish` (publish/restore revisions), `station:control` (start/stop scheduler, manual source override, manual event trigger), and `broadcast:emergency` (required for `EMERGENCY_OVERRIDE` and `CLEAR_EMERGENCY`; ordinary operators/viewers receive HTTP `403`).
- **Tenant & Channel Reference Isolation:** `validateScheduleRevision` and `POST /scheduler/control` verify that every referenced `mediaAssetId`, `videoSourceId`, and `audioSourceId` belongs to `req.user.organizationId` and is scoped to `:channelId`. Cross-tenant channel requests return `404`; cross-channel video/audio source references are rejected with `403`/`409`.
- **Resource Exhaustion Protection:** Recurrence expansion is strictly bounded to `MAX_WINDOW_EXPANSION_MS` (14 days) and `MAX_EXPANDED_OCCURRENCES` (2,000 occurrences).
- **Active Schedule Media Deletion Lock:** `SqliteMediaRepository` and `PrismaMediaRepository` block deletion (`409 SCHEDULED_PLAYBACK`) of any `MediaAsset` referenced by a `PUBLISHED` schedule revision.
- **CSV Formula Injection Neutralization:** As-Run CSV export (`?format=csv`) sanitizes every cell via `csvTextCell()`.
