# Gates: Phase One post-audit remediation

OWNS: backend/src/**, backend/agent/**, backend/verification/**, backend/test/**, backend/infrastructure/docker/**, docs/**, MASTER_REQUIREMENTS.md

Scope: Verify local remediation and revise the proposed roadmap while preserving phase and deployment approvals.

- [x] P1-SUITE: Existing workspace tests and remediation regressions pass in isolated fixtures
  CHECK: npm test
  EXPECT: # fail 0
  EVIDENCE: 43/43 workspace tests passed with 0 failures (docs/TEST_REPORT.md#obs-control-tenant-isolation-and-agent-rpc-result-schema-verification)

- [x] P1-HLS-NODE22: The synthetic HLS receiver reaches the success marker after closing its worker, receivers and SQLite fixture on Node 22
  CHECK: node backend/verification/hls-loopback.js
  EXPECT: HLS receiver and output isolation passed
  EVIDENCE: Verified on Node 22.23.5 and Node 24.15.0 (docs/TEST_REPORT.md#node-22-runtime-compatibility-and-hls-fixture-cleanup)

- [x] P1-WEB: Vite produces production assets
  CHECK: npm run build:web
  EXPECT: built in
  EVIDENCE: Production frontend built 1,614 modules with sourcemap: false and passed artifact scan (docs/TEST_REPORT.md#obs-control-tenant-isolation-and-agent-rpc-result-schema-verification)

- [x] P1-AUDIO: Real local audio monitor stops on loss of authorization while Program remains viable
  CHECK: node backend/verification/program-audio-monitor-loopback.js
  EXPECT: Organization change closes MP3
  EVIDENCE: Exited 0; verified token/session expiry, revocation, role loss and org change closure while UDP continued (docs/TEST_REPORT.md#obs-control-tenant-isolation-and-agent-rpc-result-schema-verification)

- [ ] P1-DEPLOY: Production-like isolated Linux, real OBS, and deployed security controls verified
  EVIDENCE: BLOCKED on authorized staging host; isolated Linux Compose (G64–G66) and network-disabled real OBS Studio 29.0.2 container (G50) passed in CI (docs/SECURITY_RELEASE_GATES.md)

- [ ] P1-SECRETS: Production credential ownership and authorized rotation independently verified
  EVIDENCE: BLOCKED pending owner-approved maintenance window and recovery owner; offline SQLite rekey (G9) and disposable signing-key cutover (G8) passed locally (docs/SECURITY_RELEASE_GATES.md)

- [x] P1-ADVISORIES: Production dependency graph matched against approved vulnerability data
  EVIDENCE: Offline OSV Scanner 2.7.1 matched 426 lockfile package records with 0 findings after Vite 6.4.6, esbuild 0.25.12 and Electron 45.5.0 upgrades (docs/TEST_REPORT.md#offline-npm-dependency-scan-in-the-isolated-github-job)

- [ ] P1-HLS: Windows native failure explained and Linux and Windows repeated acceptance passed
  EVIDENCE: PARTIAL (G56); Linux HLS and 12/12 + current serial Windows runs passed and missing-worker negative controls exit 1 cleanly, while the earlier one-off Windows native exit remains under monitoring (docs/TEST_REPORT.md#windows-hls-repeatability-follow-up)

- [x] P1-ROADMAP: Confirmed requirements and proposal recorded with phase gates and measurable broadcast acceptance
  EVIDENCE: Recorded in docs/DEVELOPMENT_PLAN.md, docs/TASKS.md and docs/BROADCAST_ACCEPTANCE_PLAN.md

Execution records are in [the test report](TEST_REPORT.md). [Release-gate statuses and handoffs](SECURITY_RELEASE_GATES.md) remain authoritative for infrastructure and approval dependencies.

## Local follow-up

- [x] P1-HLS-SCOPE: A signed manifest and segment are accepted only on their authorized station and session
  CHECK: node backend/verification/hls-loopback.js
  EXPECT: Signed HLS is scoped to station and session
  EVIDENCE: Verified station and session scope and 404 denial on foreign station/session (docs/TEST_REPORT.md#follow-up-verification-for-stream-scope-and-recovery)

- [x] P1-SQLITE-RESTORE: A disposable snapshot is restored and verified without modifying the source
  CHECK: node backend/verification/sqlite-recovery.js
  EXPECT: SQLite online backup and isolated restore passed
  EVIDENCE: Exited 0; preserved tenant, station, audit and revoked graphics records and refused source overwrite (docs/TEST_REPORT.md#obs-control-tenant-isolation-and-agent-rpc-result-schema-verification)

- [x] P1-SQLITE-REKEY: A disposable copy decrypts under the replacement key and preserves the original
  CHECK: node backend/verification/sqlite-rekey.js
  EXPECT: Offline station rekey copy, rejection and source preservation passed
  EVIDENCE: Exited 0; rotated station OBS password and TOTP secret on copy while preserving read-only source (docs/TEST_REPORT.md#obs-control-tenant-isolation-and-agent-rpc-result-schema-verification)

- [x] P1-NGINX-LOOPBACK: Actual Nginx denies the retired IPTV paths, preserves ingress headers and omits token-bearing paths from logs
  CHECK: node backend/verification/nginx-ingress-loopback.js
  EXPECT: Nginx loopback ingress and log checks passed
  EVIDENCE: Verified with signature-checked Nginx 1.30.8 on Windows loopback (docs/TEST_REPORT.md#actual-nginx-ingress-on-windows-loopback)

- [x] P1-NGINX-APP: Production-mode API authentication and Agent WebSocket work behind actual loopback Nginx
  CHECK: node backend/verification/phase-one-local-staging.js
  EXPECT: Actual Nginx application TLS and Agent checks passed
  EVIDENCE: Verified with Nginx 1.30.8 and Node TLS proxy, headless Chromium CSP/WSS and Agent CLI (docs/TEST_REPORT.md#actual-nginx-with-the-application-and-agent)

- [x] P1-OSV-OFFLINE: Compare the dependency lockfile with a locally downloaded public advisory database and triage the results
  EVIDENCE: Verified 0 matches across 426 lockfile records in network-disabled OSV container (docs/TEST_REPORT.md#consolidated-ci-verification)

- [x] P1-LINUX-CI: Debian Node 22 media image and Linux Compose Nginx pass isolated playback and ingress checks
  EVIDENCE: Passed all four isolated CI jobs including restricted UID/GID 1000 Compose and legacy SQLite volume restore rehearsal (docs/TEST_REPORT.md#restricted-linux-compose-verification)
