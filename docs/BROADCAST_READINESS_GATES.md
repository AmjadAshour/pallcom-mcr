# Broadcast readiness gates

OWNS: backend/src/infrastructure/program/**, backend/src/presentation/controllers/program.controller.js, backend/src/presentation/routes/index.js, backend/verification/**, backend/scripts/**, frontend/src/components/IndependentProgram.jsx, docs/BROADCAST_READINESS_GATES.md, docs/BROADCAST_READINESS_AR.md, docs/FEATURE_MATRIX.md, docs/IMPLEMENTATION_PROGRESS.md, docs/PROJECT_STATUS_AR.md, docs/INDEPENDENT_PROGRAM_STAGING.md, docs/PHASE_7_ACCEPTANCE.md, docs/STAGING_OPERATOR_GUIDE.md

Scope: Prove independent local HLS delivery and isolated recovery tools. Keep field acceptance visible.

- [ ] HLS1: An authenticated replica of Program delivers decoded audio and video over HLS, and a failed HLS destination leaves UDP running.
  CHECK: node backend/verification/hls-loopback.js
  EXPECT: HLS receiver and output isolation passed
  EVIDENCE: pending

- [ ] READY1: A live SQLite snapshot restores settings and media to a fresh path while retaining the source and refusing overwrite.
  CHECK: node backend/verification/sqlite-recovery.js
  EXPECT: SQLite online backup and isolated restore passed
  EVIDENCE: pending

- [ ] READY2: The readiness monitor detects healthy decoded tracks, loss, and recovery using an isolated broadcast.
  CHECK: node backend/verification/program-readiness-loopback.js
  EXPECT: Program readiness fault drill passed
  EVIDENCE: pending

- [ ] READY3: Program status records a single outage and recovery when an SRT destination fails and reconnects.
  CHECK: node backend/verification/srt-loopback.js
  EXPECT: SRT incident and recovery history passed
  EVIDENCE: pending

- [ ] TS1: The MPEG-TS analyzer scans a captured Program segment and detects an injected packet loss.
  CHECK: node backend/verification/hls-loopback.js
  EXPECT: Captured Program transport continuity and loss detection passed
  EVIDENCE: pending

- [ ] P7LOCAL: One staging run exercises real OBS, a native scene, a direct media URL, and signal fallback on an independent receiver.
  CHECK: node backend/verification/staging-acceptance.js
  EXPECT: Combined OBS, native scene and URL receiver checks passed
  EVIDENCE: pending

- [ ] AV1: The synthetic flash and tone offset stays within the local regression ceiling in a fresh Program capture.
  CHECK: node backend/verification/program-sync-loopback.js
  EXPECT: Program receiver flash and tone timing measured
  EVIDENCE: pending

- [ ] FIELD1: A real external destination decodes Program and its receiver reports over HTTPS through an isolated fault and recovery.
  EVIDENCE: pending

- [ ] FIELD2: An approved staging host completes the 72-hour receiver and service recovery drill.
  EVIDENCE: pending

- [ ] ADV1: The chosen live production features operate with the required devices and broadcast workflow.
  EVIDENCE: pending

- [ ] ADV2: The chosen graphics templates and feeds render correctly in Program across scene changes.
  EVIDENCE: pending

- [ ] ADV3: A reference receiver verifies the broadcaster's required cue, caption, audio and SDI profile.
  EVIDENCE: pending

- [ ] ADV4: Receivers switch between encoded renditions under available-bandwidth changes.
  EVIDENCE: pending

Direct execution results, environmental prerequisites and open acceptance items are recorded in [the readiness report](BROADCAST_READINESS_AR.md). Unlazy runner signatures are pending.
