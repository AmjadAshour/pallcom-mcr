# Deployment

Follow the [existing deployment guide](../backend/docs/DEPLOYMENT_GUIDE.md) for TLS, secrets, SQLite volume and pairing. Before any production rollout, take a tested backup, verify compatible Agent versions in staging, and obtain deployment approval. Preserve the current OBS source and leave shared device configuration unchanged during tests. Verify API, WSS, dashboard login, Agent reconnect and Program status after an approved rollout.

## Master specification operating and rollback gates

Use authorized staging and a separately restored database for migration and release rehearsal. Check protected environment configuration, service user, proxy limits, health and an independent A/V receiver before any cutover. Verify credential and playback-link redaction in application, proxy and platform logs. Confirm the owner-approved rollback window before changing the active release. The current audited runtime uses SQLite and preserves the OBS Agent boundary. [Deployment and data migration planning](DEVELOPMENT_PLAN.md)

## Phase One explicit proxy trust

Set `MCR_TRUST_PROXY_CIDRS` to the approved ingress proxy IP addresses or narrowly scoped CIDRs, separated by commas. A nonempty list takes precedence over the legacy `MCR_TRUST_PROXY=1` single-hop setting. Validate the actual ingress addresses, forwarded client IP handling and direct backend access restrictions in staging before enabling it. Restore the prior proxy configuration in an approved maintenance window if attribution changes unexpectedly.

## Phase One local staging

Build the web workspace with `npm run build:web`, then run `node backend/verification/phase-one-local-staging.js` from the repository root. Set `MCR_TEST_OPENSSL` to the local OpenSSL executable if needed. Set `MCR_TEST_CHROME` to a local Chromium executable to include browser verification. The fixture creates ephemeral loopback listeners, a temporary database and Agent state, and a one-day certificate. Node uses the fixture certificate explicitly. A disposable Chromium profile permits only the generated public key for the fixture certificate and restricts host resolution. The running application and system trust store are outside the fixture.

The fixture uses the current Agent CLI and an authenticated OBS protocol simulator. It verifies a read-only scene query through the Agent and revokes the synthetic pairing. Use the separate portable OBS procedure only in an isolated host or VM with approved network isolation. The local Node HTTPS proxy covers application behavior. Nginx and Render parity, platform logs, host ACLs, egress and least-privilege sign-off require a representative staging deployment.

Use `STORAGE_MODE=sqlite` with a protected `SQLITE_DB_PATH`. The API rejects an explicit MySQL or unknown storage mode. If a Prisma database URL is configured for separate tooling, set the runtime mode explicitly to SQLite. An installed MySQL service would still require the separately approved repository integration before it could exercise application behavior. Restore the previous deployment docs and verification file to remove the local fixture. The startup guard can be reverted independently if the previous behavior is required during an approved rollback.

## Phase One HTTPS contribution egress

Network-bound deployments using a Program HTTPS input require a numeric loopback HTTP CONNECT proxy and an explicit port. A deployment can use a separately managed policy proxy or the single-source sidecar at `backend/scripts/program-egress-proxy.js`. Provide MCR_PROGRAM_INPUT_URL and MCR_PROGRAM_INPUT_EGRESS_PROXY to the sidecar process through protected environment configuration. The sidecar and GStreamer worker must share loopback. Run the sidecar under a least-privilege service identity and do not publish its port. The sidecar accepts only CONNECT to the configured source authority. It resolves IPv4 at each connection, denies special-purpose or mixed public/private answers and dials the vetted numeric address. TLS remains end-to-end between the media worker and the source. Loopback HTTP test sources remain available in development. HTTPS sources through alternate proxies remain subject to those proxies' policies.

The supplied sidecar supports public IPv4. Authorized private sources and IPv6 require a separately managed proxy with an approved allowlist. SRT and direct UDP use different paths and require infrastructure controls. This cannot certify firewall routes, URL authenticity, proxy isolation, TLS termination or actual staging egress.

For staging sign-off, verify that the proxy port is loopback-only, that the media worker has no direct route around the proxy, and that its DNS resolver and firewall policy are appropriate. Verify legitimate authorized source availability and denial of alternate destinations. Collect both public-side TLS and receiver measurements under failure. Check that access, error and platform logs do not record keys or signed URLs. Stage independent service and credential rollback before any cutover.

## Intended production topology

The proposed two-channel Linux architecture and MySQL qualification are in [the deployment plan](DEPLOYMENT_PLAN.md). Existing deployments must preserve their storage identity. Use the [rollback plan](UPDATE_AND_ROLLBACK_PLAN.md) and the updated [IPTV instructions](IPTV_DEPLOYMENT.md) before changing the gateway.

## Restricted Linux Compose runtime

For an authorized staging deployment, append `backend/infrastructure/docker/docker-compose.restricted.yml` to the existing Compose file list. It starts the API and its media child processes as UID and GID 1000, drops Linux capabilities and prevents privilege escalation. The stock server image prepares the SQLite directory with owner-only permissions. The IPTV overlay mounts the HLS workspace as a 64 MiB private tmpfs owned by the same user. The gateway keeps its existing configuration.

Use a fresh named SQLite volume for the first rehearsal. An existing volume retains its ownership and permissions. Confirm access under the service identity against a separately restored backup before enabling this overlay on an installation with data. The database, its parent directory and SQLite journal files must be writable by that identity. Avoid recursive ownership changes on a running installation. Verify a working TLS gateway, successful login and an independent audio/video receiver before accepting the service change.

For a legacy root-owned volume, rehearse from a verified backup using a separate candidate volume. Mount the source read-only during the restore. Give the intended service identity ownership of the candidate directory and restored file, and use owner-only permissions (0700 and 0600 respectively). Under that identity, verify organization and station records, database integrity and a committed write that creates the SQLite WAL. Keep the original volume available for rollback. The [recovery procedure](OPERATIONS_RUNBOOK.md#master-specification-evidence) governs any authorized change to an existing installation.

Start the staging API twice against the same candidate volume before sign-off. After each start, use an authorized test account to confirm login, access to its station and denial of access to a station in another organization. Verify that audit events from both starts are present. Complete the authorized ingress and independent receiver checks before considering a production cutover.

To roll back during the approved window, remove the restricted overlay from the Compose file list and recreate only the affected API service using the previous deployment definition and its original volume. Preserve both volumes until recovery is independently verified. If reverting to a snapshot or an older volume, reconcile authorization and application changes made after the copy before reopening traffic. Do not put a failed identity rollout into production.
