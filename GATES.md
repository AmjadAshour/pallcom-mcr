# Gates: Baseline and station Agent liveness

OWNS: AGENTS.md, docs/**, backend/src/infrastructure/agent/**, backend/src/presentation/controllers/station.controller.js, backend/test/agent-liveness.test.js

Scope: Document the 24-module program and deliver the initial control-plane liveness and resource-boundary slice.

- [x] G1: Station Agent liveness and control-plane limits pass integration checks
  CHECK: node --test backend/test/agent-liveness.test.js
  EXPECT: Agent gateway bounds and liveness
  EVIDENCE: automatic-evidence=v1; definition-sha256=34ca3aaf5fa40a6c41355706b0e2d577c1810c66827c518752bb7d3dbaa8bf7e; exit=0; EXPECT=matched; output-sha256=22f8b936509a3649b0a0fd56ad7b3c0aa41c91c3446b6b2c3dd1cce030066a57; output-bytes=250; shell=C:\Windows\system32\cmd.exe; cwd=C:\Users\AMJAD\OneDrive\Desktop\obs; path=214c5f0e4b6e/27 entries

- [x] G2: Existing pairing, cross-tenant isolation, OBS acknowledgement and playout regressions pass
  CHECK: node --test backend/test/obs-flow.test.js backend/test/playout.test.js
  EXPECT: # fail 0
  EVIDENCE: automatic-evidence=v1; definition-sha256=11ba2d6b8b2fb03710eb1d1d043e829749a79081612442a5845857cce2803542; exit=0; EXPECT=matched; output-sha256=dce7d2d2522c396b5a0172bd7b2886fc8ff2dee61f03f699e2cc57781ffc146b; output-bytes=1348; shell=C:\Windows\system32\cmd.exe; cwd=C:\Users\AMJAD\OneDrive\Desktop\obs; path=214c5f0e4b6e/27 entries

- [x] G3: Audit and tracking reconcile the requested modules and preserve existing worktree changes
  EVIDENCE: Reviewed the matrix against modules 01–24 and recorded the original unrelated edits in the project audit.
