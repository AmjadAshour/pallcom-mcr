# Gates: Phase One post-audit remediation

OWNS: backend/src/**, backend/agent/**, backend/verification/**, backend/test/**, backend/infrastructure/docker/**, docs/**, MASTER_REQUIREMENTS.md

Scope: Verify local remediation and revise the proposed roadmap while preserving phase and deployment approvals.

- [ ] P1-SUITE: Existing workspace tests and remediation regressions pass in isolated fixtures
  CHECK: npm test
  EXPECT: # fail 0
  EVIDENCE: pending

- [ ] P1-HLS-NODE22: The synthetic HLS receiver reaches the success marker after closing its worker, receivers and SQLite fixture on Node 22
  CHECK: node backend/verification/hls-loopback.js
  EXPECT: HLS receiver and output isolation passed
  EVIDENCE: pending

- [ ] P1-WEB: Vite produces production assets
  CHECK: npm run build:web
  EXPECT: built in
  EVIDENCE: pending

- [ ] P1-AUDIO: Real local audio monitor stops on loss of authorization while Program remains viable
  CHECK: node backend/verification/program-audio-monitor-loopback.js
  EXPECT: Organization change closes MP3
  EVIDENCE: pending

- [ ] P1-DEPLOY: Production-like isolated Linux, real OBS, and deployed security controls verified
  EVIDENCE: pending

- [ ] P1-SECRETS: Production credential ownership and authorized rotation independently verified
  EVIDENCE: pending

- [ ] P1-ADVISORIES: Production dependency graph matched against approved vulnerability data
  EVIDENCE: pending

- [ ] P1-HLS: Windows native failure explained and Linux and Windows repeated acceptance passed
  EVIDENCE: pending

- [ ] P1-ROADMAP: Confirmed requirements and proposal recorded with phase gates and measurable broadcast acceptance
  EVIDENCE: pending

Execution records are in [the test report](TEST_REPORT.md). [Release-gate statuses and handoffs](SECURITY_RELEASE_GATES.md) remain authoritative for infrastructure and approval dependencies.

## Local follow-up

- [ ] P1-HLS-SCOPE: A signed manifest and segment are accepted only on their authorized station and session
  CHECK: node backend/verification/hls-loopback.js
  EXPECT: Signed HLS is scoped to station and session
  EVIDENCE: pending

- [ ] P1-SQLITE-RESTORE: A disposable snapshot is restored and verified without modifying the source
  CHECK: node backend/verification/sqlite-recovery.js
  EXPECT: SQLite online backup and isolated restore passed
  EVIDENCE: pending

- [ ] P1-SQLITE-REKEY: A disposable copy decrypts under the replacement key and preserves the original
  CHECK: node backend/verification/sqlite-rekey.js
  EXPECT: Offline station rekey copy, rejection and source preservation passed
  EVIDENCE: pending

- [ ] P1-NGINX-LOOPBACK: Actual Nginx denies the retired IPTV paths, preserves ingress headers and omits token-bearing paths from logs
  CHECK: node backend/verification/nginx-ingress-loopback.js
  EXPECT: Nginx loopback ingress and log checks passed
  EVIDENCE: pending

- [ ] P1-NGINX-APP: Production-mode API authentication and Agent WebSocket work behind actual loopback Nginx
  CHECK: node backend/verification/phase-one-local-staging.js
  EXPECT: Actual Nginx application TLS and Agent checks passed
  EVIDENCE: pending

- [ ] P1-OSV-OFFLINE: Compare the dependency lockfile with a locally downloaded public advisory database and triage the results
  EVIDENCE: pending
- [ ] P1-LINUX-CI: Debian Node 22 media image and Linux Compose Nginx pass isolated playback and ingress checks
  EVIDENCE: pending GitHub Actions run
