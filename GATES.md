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

## Independent scenes — first implementation slice

- [ ] SC1: Station operator can save and retrieve an independent local video/image scene.
  CHECK: node backend/verification/local-scene-loopback.js
  EXPECT: Local scene receiver passed
  EVIDENCE: pending
- [ ] SC2: Saving a draft leaves Program on slate, and explicit Take composites it beneath ads and watermark.
  CHECK: node backend/verification/local-scene-loopback.js
  EXPECT: Local scene receiver passed
  EVIDENCE: pending
- [ ] SC3: A separate receiver decodes motion and both layers with OBS closed.
  CHECK: node backend/verification/local-scene-loopback.js
  EXPECT: Local scene receiver passed
  EVIDENCE: pending

Direct isolated verification passed on 25 November 2026 with OBS closed. Receiver recording: host temp directory mcr-local-scene-g4Md2i, scene.ts. The formal gate runner has no approved command and environment binding for these new gates. Both builds and 27 regression tests passed independently.

- [ ] SC4: Imported video audio reaches the independent receiver only during the local scene take.
  CHECK: node backend/verification/local-scene-loopback.js
  EXPECT: Local scene receiver passed
  EVIDENCE: pending

- [ ] SC5: Incoming MPEG-TS gets a separate preview while Program stays on slate until Take.
  CHECK: node backend/verification/program-loopback.js
  EXPECT: Independent input preview and Program take passed
  EVIDENCE: pending

SC5 direct execution passed with the staging Python runtime on a separate UDP receiver. The formal runner approval and evidence binding remain pending.

- [ ] SC6: A configured private interface accepts a contribution for Preview and Take while delivery stays local.
  CHECK: node backend/verification/program-loopback.js
  EXPECT: Private-interface contribution passed
  EVIDENCE: pending

SC6 passed by direct execution with MCR_PROGRAM_INPUT_HOST set to the assigned private IPv4. The synthetic sender and receiver ran on the same host. Formal gate runner evidence remains pending.

- [ ] SC7: Configured HTTP contribution previews and takes independently, then fails over and reconnects.
  CHECK: node backend/verification/program-loopback.js
  EXPECT: Configured URL contribution passed
  EVIDENCE: pending

- [ ] SC8: Opt-in recording captures the same composited Program and audio as the live receiver.
  CHECK: node backend/verification/local-scene-loopback.js
  EXPECT: Program recording matches receiver
  EVIDENCE: pending

SC8 passed by direct execution on the staging runtime. The fixture matched decoded audio and video from the recording and receiver, then exercised a missing directory. Formal gate runner evidence remains pending.

- [ ] SC9: SRT output reconnects after receiver loss while UDP Program continues.
  CHECK: node backend/verification/srt-loopback.js
  EXPECT: SRT recovery and local output passed
  EVIDENCE: pending

SC9 passed by direct execution with the staging runtime and independent FFmpeg receivers. Formal runner evidence remains pending.

- [ ] SC10: Encrypted SRT rejects the wrong passphrase and recovers with the correct one while UDP continues.
  CHECK: node backend/verification/srt-loopback.js
  EXPECT: Encrypted SRT authentication and recovery passed
  EVIDENCE: pending

SC10 passed by direct execution with MCR_TEST_SRT_ENCRYPTED=1. Formal runner evidence remains pending.

- [ ] SC11: Sustained black input falls back while transport is still connected.
  CHECK: node backend/verification/program-loopback.js
  EXPECT: Black input fallback passed
  EVIDENCE: pending

SC11 passed by direct execution with MCR_TEST_BLACK_INPUT=1. The same sender remained connected throughout the black interval, and the receiver decoded slate and subsequent manual retake in the same Program session. Formal runner evidence remains pending.

- [ ] SC12: A connected frozen picture falls back and requires manual retake after motion returns.
  CHECK: node backend/verification/program-loopback.js
  EXPECT: Frozen input fallback passed
  EVIDENCE: pending

SC12 passed by direct execution with MCR_TEST_FREEZE_INPUT=1. The receiver decoded slate during a connected freeze and the recovered moving input after manual Take. Formal runner evidence remains pending.

- [ ] SC13: A connected silent contribution falls back and supports manual retake after audio returns.
  CHECK: node backend/verification/program-loopback.js
  EXPECT: Silent input fallback passed
  EVIDENCE: pending

SC13 passed by direct execution with MCR_TEST_SILENT_INPUT=1. A connected silent input fell back, then the receiver decoded the contribution after manual retake. Formal runner evidence remains pending.

- [ ] SC14: Input audio meter distinguishes tone from silence and clears on transport loss.
  CHECK: node backend/verification/program-loopback.js
  EXPECT: Input audio meter passed
  EVIDENCE: pending

SC14 passed by direct execution with MCR_TEST_SILENT_INPUT=1. The meter measured tone and silence, recovered before Take, and cleared on transport loss. Formal runner evidence remains pending.

- [ ] SC15: Program audio meter follows the on-air bus independently of the incoming audio meter.
  CHECK: node backend/verification/program-loopback.js
  EXPECT: Program audio meter passed
  EVIDENCE: pending

SC15 passed by direct execution using the staging runtime. Formal runner evidence remains pending.

- [ ] SC16: Program mute silences decoded receiver audio without changing contribution or session.
  CHECK: node backend/verification/program-loopback.js
  EXPECT: Program mute receiver passed
  EVIDENCE: pending

SC16 passed by direct execution using the staging runtime. Independent decoded PCM confirmed mute/unmute. FFmpeg warned about audio timestamps around source retake. Formal runner evidence remains pending.

- [ ] SC17: Receiver audio timestamps do not move backward during fallback and retake.
  CHECK: node backend/verification/program-loopback.js
  EXPECT: Program audio timestamp continuity passed
  EVIDENCE: pending

SC17 passed by direct execution on the staging runtime. The FFmpeg receiver decoded audio across fallback and retake and emitted no non-monotonic DTS warning. Formal runner evidence remains pending.

- [ ] SC18: Program gain changes decoded audio level without changing source or session.
  CHECK: node backend/verification/program-loopback.js
  EXPECT: Program gain receiver passed
  EVIDENCE: pending

SC18 passed by direct execution with the staging runtime. Receiver PCM verified −12 dB attenuation and restoration. Formal runner evidence remains pending.

- [ ] SC19: The composed Program monitor shows the same scene, watermark and ad as the independent UDP receiver.
  CHECK: node backend/verification/local-scene-loopback.js
  EXPECT: Composed Program monitor passed
  EVIDENCE: pending

SC19 passed by direct execution on the staging runtime. Formal runner evidence remains pending.

- [ ] SC20: Live Control shows incoming and composed Program pictures together in a responsive view.
  EVIDENCE: pending

SC20 manual evidence: isolated Chrome at 1400px showed both monitors side by side, 600px stacked them, and Stop removed the monitor. The UDP receiver and recording checks passed in the same fixture.

- [ ] SC21: A station retains its legacy scene and takes a second saved scene without restarting Program.
  CHECK: node backend/verification/local-scene-loopback.js
  EXPECT: Multiple saved scenes receiver passed
  EVIDENCE: pending

SC21 direct staging verification completed with a separate UDP receiver and OBS closed. Formal runner evidence remains pending.

- [ ] SC22: A saved network scene can be previewed and taken without changing Program during selection.
  CHECK: node backend/verification/local-scene-loopback.js
  EXPECT: Saved network scene receiver passed
  EVIDENCE: pending

SC22 passed by direct local execution with OBS closed. A separate UDP receiver verified the named network take and fallback. Formal runner evidence remains pending.

- [ ] SC23: Worker-rendered local scene preview leaves the independent Program receiver unchanged until Take.
  CHECK: node backend/verification/local-scene-loopback.js
  EXPECT: Worker scene preview isolation passed
  EVIDENCE: pending

SC23 passed by direct staging execution. The worker preview decoded the red and green draft while the receiver stayed on slate. Formal runner evidence remains pending.

- [ ] SC24: Optional scene fade is decoded in Program while the global graphics stay visible.
  CHECK: node backend/verification/local-scene-loopback.js
  EXPECT: Scene fade receiver passed
  EVIDENCE: pending

SC24 passed by direct execution. The UDP capture verified intermediate fade frames and persistent graphics. Formal runner evidence remains pending.

- [ ] SC25: Two live input previews operate independently, and saved scenes take either source.
  CHECK: node backend/verification/local-scene-loopback.js
  EXPECT: Dual input receiver passed
  EVIDENCE: pending

SC25 direct local receiver verification passed. Formal runner evidence remains pending.

- [ ] SC26: Primary loss takes a healthy secondary when enabled, and a secondary loss takes slate.
  CHECK: node backend/verification/local-scene-loopback.js
  EXPECT: Automatic backup receiver passed
  EVIDENCE: pending

SC26 passed by direct execution with MCR_TEST_AUTO_BACKUP=1. Formal runner evidence remains pending.

- [ ] SC27: Program continues decoding on an independent receiver while the web control process restarts.
  CHECK: node backend/verification/control-restart-loopback.js
  EXPECT: Control restart receiver passed
  EVIDENCE: pending

SC27 passed by direct execution with two Node processes and an independent UDP receiver. Formal runner evidence remains pending.

- [ ] SC28: An opted-in Program runtime restarts to a new slate session and a receiver decodes it.
  CHECK: node backend/verification/control-restart-loopback.js
  EXPECT: Program runtime auto-start receiver passed
  EVIDENCE: pending

SC28 passed by direct staging execution: the runtime restarted, restored saved revisions and the independent receiver decoded audio and video in the new session. Formal runner evidence remains pending.

- [ ] SC29: Runtime restart restores an explicitly selected source after it is ready.
  CHECK: node backend/verification/control-restart-loopback.js
  EXPECT: Saved source restored on receiver
  EVIDENCE: pending

SC29 direct execution passed: the receiver decoded slate on restart, then decoded the restored network source after it became ready. Local-file restore was not part of this fixture. Formal runner evidence remains pending.

- [ ] SC30: A local scene resumes on the receiver after runtime restart and missing media keeps Program on slate.
  CHECK: node backend/verification/control-restart-loopback.js
  EXPECT: Local scene restart and missing media passed
  EVIDENCE: pending

SC30 passed by direct execution. The receiver decoded restored local picture and audio, and decoded silent slate when the first frame was absent. The API reported unavailable. Formal runner evidence remains pending.
