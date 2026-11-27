# Phase Zero test report

## Scope

Audit performed on the existing Windows working tree based on Git revision `c3ab678`. The worktree contained pre-existing application changes, so the results apply to the checked-out tree, not solely to that commit. Node.js 24.15.0 and npm 11.12.1 were available. The host reported 12 logical CPUs and 15.8 GiB total RAM. These are fixture host characteristics and do not establish production sizing. No live OBS commands, production writes, deployment or database changes were executed.

| Check | Actual outcome and evidence |
| --- | --- |
| Specification fidelity | SHA-256 comparison between the supplied attachment and MASTER_REQUIREMENTS.md matched byte-for-byte. |
| Web build | npm run build:web exited 0. |
| Server build | npm run build:server exited 0. Its scope is the configured Node syntax check. |
| Repository suite | npm test exited 0 on isolated SQLite. 6 shared-package, 17 server, 2 frontend, 2 Agent and 1 desktop tests passed (28 total). This includes simulated OBS RPC, tenant isolation, session and credential cases, playout and bundle leak patterns. |
| Production dependency advisory check | npm audit --package-lock-only --omit=dev queried the registry and reported zero known advisories for the lockfile at audit time. |
| Native upload | scene-upload-loopback exited 0. The isolated runtime accepted a synthetic MP4 and a separate receiver decoded the video-only scene. This does not test the 128 MiB boundary or multi-GB uploads. |
| IPTV | hls-loopback exited 0. An independent FFmpeg receiver decoded video and audio from the signed URL without a browser login. The fixture exercised authenticated access, URL scope and revocation, playlist progression, range reads, and UDP continuity when HLS failed. GStreamer reported a Windows optional GIO module warning. The injected file-write failure was expected. |
| Ticker | ticker-loopback exited 0. An independent receiver verified motion and disabling on the encoded Program. |
| Watermark | watermark-loopback exited 0. A separate receiver verified placement, opacity, source switch, fallback, restart and clearing. |
| Advertising | ads-loopback exited 0. The fixture decoded 329 frames with a 90-frame ad cycle and verified video playback and layered placement. |
| SQLite recovery | sqlite-recovery printed its success assertion, then the first Windows process exited with a nonzero native status. A fresh standalone rerun exited 0 and verified a consistent online snapshot, restore to a separate path and overwrite refusal. The one-off termination remains unexplained. |
| Tracker coverage | Scripted check found all 21 numbered phase gates. The design checkpoint remains blocked pending Phase 16 evidence, owner-supplied design reference and explicit approval. |

## Open coverage

Real OBS interoperability, production TLS and reverse proxies, remote and public IPTV access, supported-source matrix, exact ingest limits on hosted infrastructure, full secrets/history scanning, browser regression across devices, migration to MySQL, representative production capacity and long-duration stability remain unverified. Earlier evidence for these features stays in the historical [implementation progress](IMPLEMENTATION_PROGRESS.md). No production readiness conclusion follows from these checks.

## Phase One partial verification

Both builds and all 28 tests passed after defensive changes. The HLS loopback passed signed playback, revocation and UDP continuity on packaging failure. Verified a synthetic VITE_ value is excluded from the resolved build environment, then rebuilt and reran frontend tests. See [Phase One evidence](PHASE_ONE_GATES.md) for specific gates and staging blockers. Phase One remains open.

## Phase One media controls follow-up

Both builds passed. The final isolated suite passed 29 tests, including the new media reservation regression and the current-role recheck. The scene upload and advertising loopbacks both exited 0. The advertising receiver decoded 329 frames and observed a 90-frame ad cycle. No production or live OBS endpoint was exercised.

## Phase One quota and credential scan follow-up

Both builds and all 30 tests passed. The SQLite quota fixture verified media, frame and audio bytes for legacy assets, rejection one byte over the cap, exact fit, station separation and space available after deletion. The separate scene-upload receiver fixture exited 0 and decoded the MP4. The exact-match scanner passed synthetic positive and negative controls before scanning the configured local values against all 50 reachable Git snapshots. See [security findings and rollback](SECURITY.md#station-media-quota-and-credential-findings).

## Phase One encryption key rehearsal

The frontend and server builds and 30 tests passed. The original SQLite recovery fixture exited 0. The separate sqlite-rekey fixture exited 0 and detected a wrong or identical key, refused overwrites, verified the new ciphertext could only be decrypted with the new key, and retained the source and unrelated ad plan.

## Phase One upload rate and secret scanning

Server build, 30 isolated tests and the MP4 receiver fixture passed. The rate-budget assertion verified a shared limit between the two upload endpoints, the retry header and continued Program reads. The dedicated secret scan used the checksum-verified upstream release, full reachable patch input and a separate nonempty current working source snapshot. See [security details](SECURITY.md#upload-throttling-and-dedicated-redacted-scan).

## Phase One credential guard and source egress

Both builds and all 34 suite tests passed. The loopback sidecar test verified the exact configured authority, numeric pinning and denial of changed or mixed DNS answers. GStreamer used the configured local proxy in the synthetic rejection fixture and kept Program on slate. The separate HTTP contribution loopback decoded audio and video and exercised failover, and the signed HLS loopback verified output continuity during an injected packaging failure. No live OBS or approved production endpoint was exercised.

## Phase One browser mutation origin verification

Both builds and the final suite of 34 tests passed. The first suite run failed because the pre-existing simulated cookie logout omitted Origin. The final integration verifies both rejection of that request and successful logout plus session revocation with an allowed Origin. The separate Program runtime fixture rejected originless and untrusted cookie writes, accepted same-origin and bearer writes and decoded uploaded MP4. The isolated signed HLS receiver also passed. No live runtime was restarted.

## Phase One browser session token verification

`npm run build:web`, `npm run build:server` and `npm test` exited successfully. All 34 tests passed across five suites (6, 23, 2, 2 and 1). The API integration used isolated SQLite and loopback. It asserted HttpOnly login cookies, absence of a JSON access token in browser login and refresh, authentication with the refreshed cookie, programmatic login and refresh compatibility and `Cache-Control: no-store` on successful and unauthorized auth responses. No live station was used.

## Phase One request body limits and dependency audit

`npm run build:web`, `npm run build:server` and `npm test` exited successfully. All 34 tests passed. The isolated loopback API returned 413 for a JSON body with 101 KiB of padding, 415 with a generic response for an unsupported `Content-Encoding`, 400 for malformed JSON, and 200 for the subsequent valid login. This tests the default primary API parser. Ingress and deployed limits still require staging verification.

Automatic approval review rejected the npm advisory query before execution because it can disclose private package names. No dependency vulnerability findings or advisory clearance were verified on this run.

## Phase One audit log read verification

`npm run build:web`, `npm run build:server` and `npm test` exited successfully. All 34 tests passed. The loopback API fixture seeded 101 synthetic local events in addition to earlier activity and a synthetic event in a second organization. It verified the 100-row default, explicit limits of 1 and 500, rejection of five invalid inputs, HTTP 401 without a session, HTTP 403 for a viewer and ownership of returned events in both organizations. Existing station deletion and Agent revocation audit assertions passed in the same integration. No live station or database was used.

## Phase One administrative account creation audit

`npm run build:web`, `npm run build:server` and `npm test` exited successfully. All 34 tests passed. The isolated API returned 403 for a viewer, 400 for a disallowed elevated role and 201 for a valid request. The database contained one `USER_CREATED` event with the expected actor, target, organization and role. The isolated database trigger rejected the next audit insert. The API returned a generic 500 and the account was absent afterward. No live database or station was used.

## Phase One CORS response verification

`npm run build:web`, `npm run build:server` and `npm test` exited successfully. All 34 tests passed. Loopback preflights to the REST login and Socket.IO polling endpoints returned the configured origin and credential support for the approved origin. Untrusted and opaque origins received no `Access-Control-Allow-Origin` header. The assertions covered `Vary: Origin` for both cases, the `nosniff` header on the health endpoint and existing REST and authenticated Socket.IO behavior. The tests used isolated SQLite. No staging TLS, proxy behavior or production CSP was verified on this run.

## Phase One production-mode header verification

`npm run build:web`, `npm run build:server` and `npm test` exited successfully. All 35 tests passed across the five suites (6, 24, 2, 2 and 1). The new fixture starts the production Express entry point on an ephemeral loopback port with generated keys and a temporary SQLite database. It measured the CSP, HSTS and `nosniff` headers on a 200 health response. This verified the application HTTP response. Browser enforcement and effective public HTTPS proxy behavior remain unverified.

## Phase One inbound HTTP deadlines and media regression

Both builds, the split runtime syntax check and all 35 tests passed. The production-mode fixture asserted 30,000 ms for headers, 300,000 ms for the complete request and a 5,000 ms deadline check interval. `scene-upload-loopback.js` and `hls-loopback.js` exited 0 against isolated SQLite. A receiver decoded moving video from the synthetic MP4 sent through the split runtime. HLS and UDP independently decoded audio and video, and UDP continued when the HLS writer failed. FFmpeg emitted startup decode warnings and GStreamer reported an optional GIO module warning. Effective ingress timing and slow-client interoperability were not measured.

## Phase One ad upload admission verification

Both builds and all 35 tests passed. The isolated loopback API integration verified that an eligible ad request reached the shared reservation before the body parser and that a parser error released the slot. The shared 12-request rate budget still returned 429 on the next request. `node backend/verification/ads-loopback.js` exited 0 on isolated SQLite after uploading synthetic PNG and MP4 assets. The independent receiver decoded 329 frames and measured a 90-frame advertising cycle. No live OBS or staging traffic was used. Peak memory under representative concurrency remains unmeasured.

## Phase One frontend artifact verification

The standard frontend build with `NODE_ENV=production`, server build and `npm test` exited 0. All 36 tests passed (6 shared, 24 server, 3 web, 2 Agent and 1 desktop). The Vite production configuration excluded both synthetic environment keys. The output scan found no tested secret patterns, source maps or synthetic marker. A nested text fixture containing an inline source-map reference and a generated marker triggered the expected categories without exposing the matched content. The initial attempt to append `--mode production` to the root npm wrapper failed because it forwarded `production` as an entry path. The successful rerun used the standard build script and verified the resolved production config directly.

## Phase One station list filter verification

The production frontend build, server build and all 36 tests passed. The isolated API integration verified the combined `OFFLINE` and `STOPPED` filters, an empty result for a valid nonmatching filter, an empty result under a different organization, and a generic HTTP 400 for unknown, empty and repeated filters. The integration used temporary SQLite and simulated Agent messages on loopback. No live OBS or staging traffic was used.

## Phase One station studio organization scope verification

The production frontend build, server build and all 36 tests passed. The isolated API fixture created studios in two synthetic organizations. It verified same-organization assignment on create and update, matching 404 responses for missing and foreign studio references, retention after rejected updates and removal by explicit `null`. The fixture used temporary SQLite and loopback. No live OBS or staging traffic was used.

## Phase One pairing rate-limit isolation verification

The production frontend build, server build and all 36 tests passed. The isolated API counted four existing fixture claims and six schema-rejected requests against the pairing budget. Request eleven returned a pairing-specific HTTP 429 and a positive `Retry-After` value. The same loopback client then received 200 on a valid login. The fixture used temporary SQLite and a simulated Agent. It did not measure external proxy IP attribution or multiple server instances.

## Phase One administrative response and write verification

The production frontend build, server build and all 36 tests passed. The isolated API asserted `Cache-Control: no-store` on 401 and 200 responses for the user and audit lists. The user list contained the newly created user and excluded the other organization's user and password hashes. A creation request with an undeclared organization field returned 400 and left no account row. The valid creation and simulated audit failure checks also passed. No live system was used. Effective cache behavior at staging ingress remains unverified.

## Phase One refresh request validation verification

The production frontend build, server build and all 36 tests passed. The loopback API fixture rejected the three invalid request shapes with generic 401 responses, `Cache-Control: no-store` and no `Set-Cookie`. It then used the same original token successfully in a valid JSON request. The separate browser cookie refresh and existing token reuse checks passed against temporary SQLite. No live or staging environment was used.

## Phase One REST role verification

The production frontend build, server build and all 36 tests passed. The loopback fixture checked five REST routes for each of the five configured roles and one unrecognized stored role. It distinguished permission denial (403) from schema rejection (400) on two write routes and verified 404 for a station read by another organization's administrator. It used isolated SQLite and sent no live OBS commands. Coverage is limited to the routes exercised.

## Phase One dashboard socket verification

The production frontend build, server build and all 36 tests passed. The loopback integration used isolated SQLite. Socket.IO rejected an unrecognized stored role during authentication. A viewer received a playout snapshot for a station in their organization, and an administrator from another organization received only a station-not-found response. The existing logout test confirmed disconnection. No live OBS or staging proxy was used.

## Phase One HLS response privacy verification

The production frontend build, server build and all 36 tests passed. The loopback proxy fixture verified both privacy headers on the playlist, byte range, link issuance and denied requests before and after revocation. The first receiver run stopped with Windows exit code -1073740791 after analyzing the transport sample. A standalone rerun exited 0, decoded HLS and UDP audio and video, and confirmed continued UDP output after HLS writer failure. The optional Windows GIO module warning persisted. The affected code and fixture were tested with synthetic media and isolated SQLite. Public ingress behavior was not verified.

## Phase One restored tenant and audit verification

`node backend/verification/sqlite-recovery.js` and `node backend/verification/sqlite-rekey.js` exited 0 on temporary SQLite. The expanded restore fixture compared station ownership and committed audit events in two organizations and excluded a later audit event. Existing assertions verified the snapshot boundary, media bytes, Program settings and destination overwrite refusal. Both builds and all 36 tests passed. Effective file ACLs, production data and staging recovery time remain unverified.

## Phase One station write schema verification

Both builds and all 36 tests passed. The temporary SQLite API fixture returned 400 when organization ownership was supplied on create and when runtime state was supplied on update. Station and audit counts were unchanged and the old port and stream state persisted. A subsequent supported OBS port change succeeded and was readable. No live OBS was used.

## Phase One login request bounds verification

Both builds and all 36 tests passed. The isolated login fixture rejected a 4,097-character password and an unexpected role field with HTTP 400. Neither request set cookies or created a session. A subsequent valid login and the existing refresh and logout checks succeeded. No live or staging environment was used.

## Phase One CSV export verification

Both builds and all 37 tests passed (7 shared, 24 server, 3 web, 2 Agent and 1 desktop). The formatter unit test checked Arabic, commas, embedded quotes, line breaks, leading whitespace and ASCII and fullwidth markers. The isolated schedule API fixture checked the attachment header and CSV row content and verified a 404 for a different organization. The audit page uses the formatter and compiled successfully. Browser download and spreadsheet import were not exercised.

## Phase One temporary media cleanup verification

The production frontend build, server build and all 37 tests passed. `node backend/verification/scene-upload-loopback.js` exited 0. The split loopback runtime used a dedicated temp directory and isolated SQLite. It returned 400 for synthetic text labeled MP4 and kept the media library empty. The fixture found no preparation directory after rejection or after valid upload. A separate UDP receiver decoded moving video from the uploaded MP4. The fixture did not inject transient file locks, inspect deployed Windows ACLs or test process-kill recovery.

## Phase One scheduled automation scope verification

Both builds and all 37 tests passed. The isolated integration created two scheduled scene jobs through the REST API, moved one creator to another organization, and made both jobs due in temporary SQLite. The worker marked the moved creator's job failed and recorded its audit event. The simulated Agent received exactly one command, for the job owned by the station's organization, and acknowledged it. No live OBS station was used.

## Phase One manual automation audit verification

Both builds and all 37 tests passed. The isolated API returned 404 for a foreign administrator's macro run request. A same-organization operator then ran the macro through a simulated Agent. The only successful event for that macro recorded the operator, and the job still showed its creator. The successful scheduled run recorded its creator. No live OBS station was used.

## Phase One automation cancellation audit verification

Both builds and all 37 tests passed. The isolated API kept the existing conflict response for a foreign cancellation. A temporary SQLite trigger rejected the audit insert, and the API returned 500 while the job stayed scheduled. After removing the fixture trigger, two concurrent requests returned one 200 and one 409. The cancelled job had one audit event identifying the actor, organization, station and job. No live OBS station was used.

## Phase One automation creation audit verification

Both builds and all 37 tests passed. The isolated API created a manual macro and a scheduled job and checked the actor, organization, station and exact event details for each. A temporary SQLite trigger rejected the audit insert and the failed request returned 500 without leaving a job. The cancellation rollback and concurrent request checks still passed. No live OBS station was used.

## Phase One proxy trust verification

Both builds and all 38 tests passed (7 shared, 25 server, 3 web, 2 Agent and 1 desktop). Startup tests checked IP address and CIDR validation. The production-mode fixture with both settings present asserted that Express trusted the configured IPv4 subnet and IPv6 address and denied addresses outside them. It used isolated SQLite and loopback. Deployed ingress attribution and direct backend reachability were not measured.

## Phase One loopback proxy audit attribution

Both builds and all 38 tests passed. A disposable HTTP proxy sent two successful login requests to the local production-mode server. The first audit event recorded the peer IP with the proxy outside the trust list. After the fixture set the trust list to authorize that peer, the second event recorded the forwarded documentation-only client IP. Both events were read from temporary SQLite. Neither public ingress nor an installed reverse proxy was tested. Remove the fixture assertions and proxy setup to roll back this verification change.

## Phase One consolidated local staging evidence

| Check | Actual result |
| --- | --- |
| Production build and regression | Frontend and server builds exited 0. All 39 tests passed (7 shared, 26 server, 3 web, 2 Agent and 1 desktop). The web build used synthetic environment markers and the output audit passed. |
| Local TLS and ingress behavior | `phase-one-local-staging.js` exited 0. The Node client verified a one-day loopback certificate, rejected it without explicit trust, negotiated TLS and measured CSP, HSTS, secure cookie flags and forwarded-IP audit attribution. |
| Browser | Chromium rendered the built React dashboard, blocked a harmless inline script, completed a cookie login and authenticated a WSS Socket.IO session. The token was absent from browser-visible JSON and cookies. The first browser attempt did not resolve the fixture page. Explicit loopback exclusion from the hostname restriction and direct proxy settings corrected the fixture. |
| Agent | The real CLI paired into a temporary keystore with an explicitly trusted certificate, authenticated to a MessagePack OBS simulator and read its scene list over WSS. It observed revocation. The first simulator attempt timed out because it sent JSON instead of MessagePack. No installed OBS profile or live station was contacted. |
| Runtime storage | Startup rejected explicit MySQL, an implicit mode selected by a MySQL URL and an unknown mode without echoing the URL. Explicit SQLite remained available. MySQL Workbench was present, the MySQL80 service was absent, and no server executable was found in the normal locations. The application has no active MySQL runtime path. |
| Station role coverage | 36 additional requests covered nine station reads as a guest, foreign user, viewer and authorized controller. These covered playout, legacy graphics, the main monitor API and four media configuration surfaces. |
| Redacted secret rescan | The working-tree snapshot contained 240 tracked or unignored files. Gitleaks history and source scans each reported one generic-key rule hit with findings exit code 1. Values were suppressed. |
| Offline package inventory | The lockfile contained 241 non-dev, non-link entries, all with integrity metadata. Root `npm ls --omit=dev --all --offline` exited 1 with two extraneous optional-package entries and two missing workspace entries. The server-filtered command exited 0 and still reported two extraneous entries. No advisory request was sent. |
| Recovery | SQLite backup/restore and offline rekey fixtures each exited 0. |
| Media playback | Split-runtime MP4 upload and advertising fixtures exited 0. The advertising receiver decoded 329 frames and measured an 89-frame rotation cycle. The local HTTPS contribution used the expected proxy and held slate on denial. HLS and UDP decoded independently and UDP continued when HLS failed on a standalone rerun. |
| HLS Windows reliability | The first regression run exited with Windows code -1073740791 after the packet analyzer. The standalone rerun exited 0. The Application Error query returned no matching event. The native exit cause and repeated-run reliability remain unverified. |
| Encrypted SRT | The independent receiver decoded audio and video from the protected output. The fixture confirmed authenticated reports, their expiration after receiver disconnect and recovery within the same Program session. It exited 0. |
| Audio monitor | The initial attenuation check timed out. The test now preserves partial PCM samples across chunk boundaries and measures the before/after levels over at least one second without changing the accepted attenuation range. The rerun exited 0, covering denial outside the organization, mute, attenuation, revocation while UDP continued and disabled monitor startup. |

Deployed TLS, Nginx or Render behavior, production console and proxy logs, file permissions and privilege, authorized real OBS and actual credential rotation remain separate acceptance requirements. Remove the staging fixture and route checks to roll back verification-only changes. The storage behavior and its rollback are documented separately. [Security](SECURITY.md#phase-one-local-staging-boundary)
## 2026-11-27 post-audit Phase One verification

The pre-change working tree was based on `c3ab678307f2994f35dbb33f2e0a67efbbe237c3` and had 89 status entries. No production service, database or credential was used. All media fixtures used loopback and synthetic data.

| Command | Actual evidence |
| --- | --- |
| `npm test` | Pre-change rerun and post-change suite passed 39 tests (7 package, 26 server, 3 web, 2 Agent and 1 desktop). No failures, skips or cancellations in those runs. An initial sandbox run failed on loopback EACCES. A later automated approval attempt still applied the prior read-only scope and was rejected. The explicitly scoped post-audit fixture run succeeded. |
| `npm run build:web` | Vite production build passed and processed 1612 modules. The frontend artifact checks also passed. |
| `npm run build:server` | Passed. The script is a Node syntax check of the entry point. |
| `node --experimental-test-coverage --test backend/test/*.test.js` | Passed 26 tests with 70.17% lines, 71.83% branches and 63.30% functions across files loaded by Node for the covered server run. Includes the legacy graphics schema migration, expiry, invalidation and authorization checks. |
| `node --experimental-test-coverage --test backend/packages/*/test/*.test.js frontend/test/*.test.js backend/agent/test/*.test.js dicktob/test/*.test.js` | Passed 13 tests during the earlier coverage run. Node reported 58.38% lines, 81.25% branches and 20.95% functions across loaded files. This is not client browser or GStreamer coverage. |
| `node --test backend/agent/test/agent.test.js` | 2 passed under real Windows ACL semantics. Test verified a protected directory, current-user/SYSTEM ACL, ciphertext on disk, legacy migration, round-trip and clear. The sandbox could not persist the ACL change. Linux branch unexecuted on this host. |
| `node backend/verification/program-audio-monitor-loopback.js` | Exited 0. Access token expiry, invalid reconnect, session expiry, revoked session, lost role and organization changes terminated monitoring while UDP continued. MP3 and AAC decoded independently. Mute, restoration, attenuation and disabled-monitor checks passed. |
| `node backend/verification/hls-loopback.js` | Windows development run exposed `-1073740791` with a libuv `UV_HANDLE_CLOSING` assertion after a fixture assertion. With the expected sanitized 503 and receiver cleanup fixed, three consecutive final media runs exited 0 and verified protected playlists and segments, live window progression, HLS writer failure isolation and continued UDP decode. The optional Windows GIO-module warning recurred. G56 stays open pending root cause of the original failure and Linux parity. |
| `node backend/verification/phase-one-local-staging.js` | Final rerun exited 0. Local TLS and forwarded-IP attribution, Chromium CSP and WSS, Agent CLI pairing, scene read and revocation against a MessagePack OBS simulator passed. An earlier pass logged a scheduling tick after the fixture closed SQLite. The server now cancels future schedule ticks on close. One attempt exited during Agent pairing before its error was captured. The fixture now drains its Agent output and pairing errors exit after the console flush. |

The native media fixtures run separately from the 39 tests. Actual Nginx and Linux Compose, production provider admission, credential cutover and advisory review remain separate gates. See [release requirements](SECURITY_RELEASE_GATES.md).

### Files in this checkpoint

Application changes cover `backend/src/index.js`, `backend/src/presentation/middlewares/auth.middleware.js`, `backend/src/presentation/controllers/program.controller.js`, `backend/src/presentation/routes/graphics.js`, `backend/src/infrastructure/database/sqlite.js`, `backend/src/infrastructure/program/supervisor.js`, `backend/agent/src/index.js`, `backend/agent/src/keystore.js`, the Nginx/Compose IPTV configuration and the sanitized environment template. Existing server/Agent tests and the audio, HLS and TLS verification fixtures were updated.

The master specification, development plan, task tracker, architecture, security, test report, acceptance gates, feature matrix, changelog, implementation progress, API, deployment, IPTV and independent Program documentation were updated. New plans cover MySQL migration, multi-channel architecture, broadcast acceptance, deployment, and update and rollback. The working tree contains additional user changes that predate this checkpoint.
### Follow-up verification for stream scope and recovery

All three commands exited 0 on the local Windows host.

| Command | Evidence |
| --- | --- |
| `node backend/verification/hls-loopback.js` | The signed playlist and a segment were accepted for the original station and session. Both returned 404 for a different station in the same organization and for a different session, with privacy headers intact. Separate HLS and UDP receivers decoded A/V, and UDP continued through an injected HLS writer failure. The optional GIO-module warning recurred. G56 remains open. |
| `node backend/verification/sqlite-recovery.js` | Backup and isolated restore preserved tenant and audit records, ad frame data and the expired marker on a revoked graphics credential. The fixture rejected an attempt to restore over the existing source. |
| `node backend/verification/sqlite-rekey.js` | The copied database decrypted with its replacement key, rejected invalid key use, and preserved the original. Only fixture keys were exercised. |

Docker, Nginx and an offline advisory scanner were unavailable on the host. The WSL launcher reported that WSL was not installed. Real Linux ingress and provider authorization remain pending. [Release gates](SECURITY_RELEASE_GATES.md)
### Actual Nginx ingress on Windows loopback

`node backend/verification/nginx-ingress-loopback.js` passed with Nginx 1.30.8 on Windows using temporary TLS, loopback ports and a synthetic HTTP upstream. The [official Windows archive](https://nginx.org/en/download.html) passed detached-signature verification using the [published signing key](https://nginx.org/en/pgp_keys.html). Archive SHA-256 was `ccd0c03ff665d4534e6595e455624ededc9eeb11a81a6a128920fcc928be1151`.

The test first caught a 404 from the signed HLS nested location and a credential-bearing overlay request in a gateway log. Explicit upstream directives now route the signed HLS and video upload locations. The overlay rewrite serves the app index without leaving the log-suppressed location. The passing run checked 308 redirection, TLS and CSP headers, overwritten forwarding headers, 404 for retired IPTV manifest and segment URLs, and routing for signed HLS, graphics and uploads. It shut down the stub upstream to confirm that graphics and signed HLS tokens remained absent from access and error logs while an ordinary request appeared in both. Windows gateway failures can return 502 or 504.

The fixture adjusts only loopback addresses, ports, local file paths, temporary storage and upstream timeouts. Existing application authorization is covered by the separate HLS integration fixture. Linux Compose, actual OBS and deployed platform logging remain open.
### Actual Nginx with the application and Agent

`node backend/verification/phase-one-local-staging.js` exited 0 on Windows with `MCR_TEST_NGINX` selecting the signature-verified Nginx 1.30.8 binary. The same fixture exited 0 using its original Node proxy. Both used disposable SQLite, a temporary TLS certificate, generated credentials and an OBS protocol simulator.

The real Nginx run verified the app's secure cookie attributes, certificate trust and audit attribution. The gateway replaced a client-supplied forwarding address with the actual loopback peer. The application returned 403 for both a foreign-origin login and a foreign-origin Socket.IO polling handshake. Chromium rendered the built dashboard through Nginx, enforced CSP and authenticated WSS using HttpOnly cookies. The real Agent CLI paired through Nginx, read the simulator's scene list through its WSS connection and observed revocation.

After extracting the common fixture configuration, `node backend/verification/nginx-ingress-loopback.js` passed again with the synthetic upstream. An initial negative test tried to inspect upgrade errors through a test proxy that closes denied upgrade sockets. The passing negative case measures the HTTP polling handshake. This checkpoint changes only verification fixtures and documentation. Linux Compose, deployed services and real OBS still require authorized staging.

### Offline advisory acquisition attempt

The public OSV Scanner 2.7.1 binary and the public npm advisory archive were requested independently of the repository. The scanner download and resume timed out. The npm archive advertised 222,629,163 bytes, and neither the direct transfer nor the bounded range retry completed. Partial files were not executed or used for a scan. No package inventory or credentials were sent. G18 remains blocked in this environment. A complete offline run needs a verified scanner binary and a complete npm advisory archive in the scanner's local database cache, or an approved internal service. [Official offline mode](https://google.github.io/osv-scanner/usage/offline-mode/)
### GitHub review checkpoint

The Windows review checkpoint passed all 39 tests in `npm test`, with no failures or skips. `npm run build:web` produced the frontend assets and `npm run build:server` passed the API entry-point syntax check.

The real Nginx application and synthetic upstream fixtures both exited 0. The HLS loopback and Program audio monitor fixtures exited 0 with isolated SQLite and synthetic media. They verified signed output scope, continued UDP decoding during a simulated HLS writer failure, and monitoring authorization during session and role changes. The Windows GIO warning remains, as do Linux target validation and G56.

The staged snapshot comparison with configured local credentials initially identified four inherited literals. The source now uses random local fallback keys, rejects historical defaults on network-bound instances and requires explicit previous and replacement password inputs for bootstrap account migration. The production-mode Nginx fixture rejected the exposed bootstrap password. A separate child process migrated the legacy account on disposable SQLite and verified that the old password was no longer valid. The follow-up staged Gitleaks 8.28.0 scan and exact comparison across all staged files reported zero matches. Existing Git history was retained.
