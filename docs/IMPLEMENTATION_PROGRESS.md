# Implementation progress

2026-11-24. Phase 00 baseline and the initial phases 01–02 control-plane slice. All 20 pre-change tests passed against a temporary SQLite path. Existing README and Windows Agent worktree edits were noted before work. The development slice changes only the server Agent gateway, station status, tests and planning documents. No deployment was performed.

The post-change suite passed 21 tests on Node.js 22. GATES:G1 passed simulated heartbeat loss, telemetry expiry/recovery, validation, and command backlog handling. GATES:G2 passed the authenticated Agent tunnel, cross-tenant checks, OBS acknowledgement simulation, and playout regressions. GATES:G3 records the manual documentation comparison.

The first-slice security review found that Agent command result schemas, credential rotation/revocation, enrollment and MFA still need follow-up. No actual OBS output or broadcast continuity was measured. See the [task register](TASKS.md) and [acceptance gates](../GATES.md).

## Continuation — P0-003A

Added scoped credential generations and revocation, old-socket disconnection, expiry, atomic pairing-code invalidation and audit logging. Legacy credentials continue until each station is rotated. Added the Settings action and updated the operational instructions.

`npm test` passed 21 tests using temporary SQLite. `npm run build:web` and `npm run build:server` passed. `npm audit --package-lock-only --omit=dev` reported zero known findings. Both [credential acceptance gates](AGENT_CREDENTIAL_GATES.md) passed. No real broadcast, production rollout, or hardware acceptance test was performed.

Next P0 task: split MFA enrollment/recovery from audit tamper resistance and start with MFA for privileged users. Keep Agent command-result schemas and a longer enrollment token tracked before enabling independent network-facing workers.

## Monitoring and replay controls — Modules 21 and 08

Multiview displays averaged OBS stream bitrate from output byte and duration deltas and sampled peak dBFS per named OBS input. A reconnect, a stopped stream, or invalid counters clear the measured bitrate. Stale meter samples are omitted. Operators can start, stop, or save the configured OBS replay buffer through station-scoped, audited commands. OBS save events update the last-save timestamp without exposing a local file path.

These controls require an updated station Agent. OBS must have Replay Buffer enabled in its Output settings. Clip playback, advanced replay editing, and a separate encoding worker remain pending. No live output settings were changed.

## Operator-facing slice — Module 21

Multiview now presents sortable station tiles, responsive column presets, Program and Preview snapshots, and fullscreen. Preferences are scoped to the dashboard user and organization in browser storage. The existing station-scoped snapshot endpoints remain the media source, with no new broadcast commands.

`npm run build:web` passed. Local Chrome with synthetic station responses confirmed drag-and-drop, bus selection, preference persistence and fullscreen. Actual OBS output, measurement of capture latency, larger deployments, audio meters and independent encoded multiview remain unverified or unimplemented. Rollback is limited to the Multiview page and these documentation updates.

## Independent Program initiative — Phase 1 audit

The [implementation specification](INDEPENDENT_PROGRAM_SPEC.md) traces current signals, proposes service and timing contracts, and defines receiver acceptance gates. Four existing simulated playout and bitrate tests passed locally. Deployment identity and actual Program output remain unverified. Rollback consists of removing the specification and this progress entry.

## Independent Program initiative — Phase 2

A single opt-in station can start and stop a separate GStreamer worker and select a loopback OBS contribution. A real portable OBS sender and an independent receiver exercised loss, fallback and manual return. A separate Chrome run captured output after closing the operator tab. See the [staging instructions, evidence and rollback](INDEPENDENT_PROGRAM_STAGING.md).

## Independent Program initiative — Phase 4 watermark

Implemented against the Phase 2 worker and its 720p output profile. A clean image sampled before the watermark supplies the editor Preview. A revision-checked apply stores the station settings and emits the final overlay after source selection. The local receiver fixture checked a 2:1 uploaded image, inset, opacity, source changes, signal-loss fallback, disabling and restart. The Chrome check exercised pending edits and explicit apply. See the [staging runbook](INDEPENDENT_PROGRAM_STAGING.md) for reproduction and rollback.

## Independent Program initiative — Phase 5 advertising

Added a station-scoped image/video library, four independent placement playlists and revision-checked Preview/Apply and live controls. The broadcast scheduler persists timing and override state in SQLite. Receiver testing exposed a one-frame overlap glitch at a lower placement's gap; keeping each placement in a stable layer fixed it. Clock tests cover scheduled eligibility, rotation, simultaneous starts, overrides, restart and DST. The local 720p25 receiver measured a 90-frame cycle (3.6 seconds), decoded the short video repeating, and confirmed the upper placement stayed visible. See the [staging procedure and rollback](INDEPENDENT_PROGRAM_STAGING.md).

## Independent Program initiative — Phase 7 staging acceptance

Full workflow acceptance failed on native scene composition and URL Preview/take. A combined local run exercised actual OBS, a separate picture/audio receiver, watermark, two ad placements, browser refresh, controlled service restart and fault recovery. Fixed RGB watermark opacity handling and added a regression. See the [scenario matrix, evidence and rollback](PHASE_7_ACCEPTANCE.md) and [operator quick guide](STAGING_OPERATOR_GUIDE.md).

## Independent local scene slice

A station can save and take one local scene containing an imported looping silent video with a positioned image. The browser previews its draft. The separate receiver fixture verified slate before Take, motion and both graphics layers during the take, and the return to slate in the same session. See the [staging runbook](INDEPENDENT_PROGRAM_STAGING.md) for operation and rollback. Network input and a worker-side Preview bus remain open.

Local scene MP4 imports now retain stereo audio. The isolated receiver decoded silence before and after the take and the generated tone during the take. Re-import older clips to supply their source audio. Ads remain silent.

The independent contribution now has a decoded still-image preview distinct from Program. A synthetic MPEG-TS sender and a separate FFmpeg receiver verified red input preview over blue on-air slate, then red Program only after Take, stale preview clearing on loss, and manual retake after reconnect.

Private-interface contribution passed the same-host physical-interface fixture. The separate receiver stayed on loopback and verified Preview, Take, loss and manual return. Cross-device firewall and routing remain unverified.

The independent contribution supports a server-configured direct MPEG-TS URL, with URL credentials excluded from Program status, redirects disabled and manual retake after recovery. Local HTTP was verified on a separate receiver. Live HTTPS deployment remains unverified.

Optional Program recording writes the composited session to a host-local MPEG-TS file. The receiver fixture matched sequences of decoded audio and video frame hashes from the live UDP capture and the local recording. A missing directory reported recording failure while Program remained running.

An optional SRT caller destination now carries Program alongside local UDP. Separate receivers decoded audio and video, then UDP advanced during SRT loss and a replacement SRT receiver decoded the same session. Remote and encrypted destination interoperability remain unverified.

SRT now accepts a server-side passphrase and reports encryption configuration without exposing the secret. Separate receivers confirmed that an incorrect passphrase yielded no decoded audio or video, UDP continued, and a receiver with the correct passphrase decoded the same Program session before and after disconnect.

Added opt-in sustained black detection for network contribution. Local receiver verification covered black while connected, blocked Take during black, manual recovery, and ordinary transport loss and reconnect. Disable with MCR_PROGRAM_BLACK_SECONDS=0. See the staging runbook for behavior and settings.

Added opt-in frozen-picture detection on the network contribution. The receiver fixture verified fallback while the sender remained connected and manual retake once picture motion recovered. Roll back operationally with MCR_PROGRAM_FREEZE_SECONDS=0. See the staging runbook.

Added opt-in silence detection for decoded contribution audio at −60 dBFS RMS. The loopback receiver fixture confirmed fallback while the sender remained connected, blocked Take during silence, and a manual retake after healthy audio returned. Roll back operationally with MCR_PROGRAM_SILENCE_SECONDS=0.

The independent contribution reports input RMS in dBFS before Take. The loopback receiver fixture verified tone, silence, recovery and clearing on disconnect. The meter also runs when silence fallback is disabled.

Added a separate pre-encode Program RMS meter. The loopback fixture verified silent Program with incoming tone, tone after Take and silence after fallback.

Added session-scoped Program mute/unmute before encoding with station-control authorization. A separate UDP decoder verified silence and restored audio without a Program session change. FFmpeg reported non-monotonic audio timestamps around source retake during the same run. The receiver assertions, both builds and all 27 repository tests passed.

Program now timestamps all PCM from a single sample counter. A bounded contribution queue supplies that clock, with silence on underrun. Receiver checks passed source loss, retake, mute and unmute without the previous backwards audio timestamp warnings. Local scene and recording checks also passed. Long-run A/V drift remains unmeasured.

Added an audited Program attenuation control from −30 to 0 dB. Local receiver PCM verified a −12 dB change and restoration within the same session.

Added a station-scoped composed Program monitor. The local scene fixture verified image, watermark and ad in the monitor and in the independent UDP receiver. The monitor cleared on stop.

Live Control now displays separate input and Program monitors together. The isolated Chrome fixture verified wide and narrow layout and removal on stop. Reverting the IndependentProgram layout restores the previous collapsible input view.

Added named local scene storage and selection while retaining the original scene API. The receiver decoded different overlays from two saved scenes in one session with OBS closed. The original scene remains accessible if the named-scene UI is rolled back.

Named scenes can now reference the existing station network input. The separate receiver decoded the saved network take with graphics and then slate on input loss. UDP was used in this fixture. To remove this workflow revert the named network scene route and editor additions together.

Local scene editor can request a still frame from the broadcast worker. The separate UDP receiver fixture verified isolation and subsequent Take. The route and button can be reverted together while retaining browser preview.

Added optional fade from black on saved scene Take. The UDP fixture verified intermediate grayscale frames followed by the white network scene while the global logo and ad remained visible.

Added concurrent primary and secondary ingest with independent status and preview. Local UDP fixtures verified selecting both saved network scenes and that loss on the off-air input leaves Program on the other input. Unset MCR_PROGRAM_SECOND_INPUT_PORT to return to one input.

Added opt-in primary-to-secondary automatic failover. The UDP fixture decoded primary, then healthy backup and finally slate with the same session. Unset MCR_PROGRAM_AUTO_BACKUP to revert the policy.

Optional loopback Program service lets the web process restart while the worker stays up. A staging receiver continued decoding video and PCM during the outage. The recovered UI API returned the same session and accepted mute and stop. Removing the opt-in restores single-process mode.

Opt-in runtime boot starts Program on slate using persisted graphic and ad revisions. The separate receiver decoded the new session after restarting the runtime without a Start request. Unset MCR_PROGRAM_AUTOSTART to revert.

Added opt-in recovery of the last successful operator source selection on Program runtime boot. A new session starts on slate and network recovery waits for readiness within a bounded window. Unset MCR_PROGRAM_RESTORE_SOURCE to revert.

Verified local-scene restart with independently decoded video and audio, then removed the first video frame in fixture SQLite and verified safe slate. Live Control displays unavailable or waiting during recovery. The status UI can be reverted independently.

Added one-shot named scene scheduling for independent Program. Pending events are cancellable and the schedule log records engine acceptance or failure. To roll back, remove the scheduler and its scene editor controls together. Existing saved scenes are separate from scheduled events.

Added optional 24-hour recurrence for scheduled scene takes. Claim and creation of the next occurrence share a transaction. Cancelling the pending occurrence ends the series. To revert, remove the recurrence controls and scheduler extension while retaining existing pending events as one-shot takes.

Added atomic one-shot sequences of up to 32 named scenes with cumulative take times. Existing scheduler records acceptance for each take. Remove the sequence endpoint and editor controls to revert; saved events remain ordinary scheduled takes.

Optional local filler is appended as a scheduled take at the end of a scene sequence. Filler participates in atomic conflict detection and uses the same execution log. Choose the keep-final-scene option to revert the behavior for new sequences.

Added a persisted schedule hold for operator overrides. Due events are logged as skipped while recurrence continues. Remove the hold controls and claim check together to roll back.

Added station-scoped UTF-8 CSV schedule export with UTC timestamps and spreadsheet formula escaping. Separate runtime proxy preserves the attachment header. Remove the export route and link together to roll back.

Added pending event rescheduling with an expected original timestamp and atomic conflict protection. The daily marker stays attached to the same event. Revert the PATCH endpoint and editor controls together to remove rescheduling.

Program fans out the same encoded MPEG-TS to optional primary and secondary SRT callers and local UDP. Each SRT caller has a separate bounded queue, worker thread, retry state and server-side encryption setting. Live Control reports each caller state. The loopback receiver test decoded H.264 and AAC on all three outputs, then confirmed continued decoding on the second SRT receiver during loss and reconnection of the first without changing the Program session. External delivery remains open. Unset both secondary SRT variables before starting a new session to roll back to one SRT destination.

Optional SRT destination probes report recent decoded H.264 and AAC independently of sender state. Destination-scoped bearer credentials authorize reports only. Program status expires reports after eight seconds and waits for fresh evidence on a new session. The encrypted loopback probe decoded both tracks, went offline when stopped and recovered in the same broadcast session. Station, destination and credential checks and synthetic single-track reports were exercised by the acceptance fixture. External HTTPS reporting and receiver deployment remain open. Stop the probe and unset its server token to disable monitoring.

Independent Program can mix two network inputs. Operators can set follow-picture, mix-when-ready or mute and apply -30 to 0 dB per input with station-control authorization. The worker retains the single output audio clock and removes sources that lose readiness. Separate FFmpeg UDP decoding measured both test tones together, secondary-only attenuation, per-input and master mute, explicit audio under slate, and silence after secondary loss. Long-run synchronization remains open. Return inputs to follow-picture at 0 dB to restore default routing.

Live Control adds user-initiated listening to a station-scoped MP3 monitor from the final Program audio mix. Chrome played it with a viewer session. An independent FFmpeg fixture decoded the monitor and the UDP broadcast concurrently and verified tone, mute, gain and restoration. It also verified that revoking the viewer session closes the monitor while UDP continues, and that stopping Program closes active listeners. Browser support beyond Chrome, production proxy buffering and long-run latency remain open. Set MCR_PROGRAM_AUDIO_MONITOR=0 before starting the next session to disable the branch.

Independent Program can serve a private, single-rendition HLS playlist and segments using the existing read authorization. Its separate packaging graph isolates write failures. Separate receivers verified HLS audio and video, range access, retention and continued UDP decoding during a packaging failure. Live Control lists recent HLS and SRT incidents for the current session. The SRT fixture verified a single failure and recovery event for the affected destination while the other remained on air. Unset MCR_PROGRAM_HLS_DIR before starting the next session to disable HLS.

Host-side recovery tools can snapshot active SQLite, restore to a new file and verify database integrity. Staging exercised an uncommitted update and a stored creative, with overwrite refused. The readiness observer decoded UDP audio and video over a 60-second fault drill and detected loss and restart. A separate capture analyzer detected injected continuity loss in a delivered HLS segment. These tools require no changes to live configuration. [Readiness and rollback](BROADCAST_READINESS_AR.md)

The input decoder now clocks both tracks before feeding them into Program and limits contribution audio buffering to four buffers. The receiver flash-and-tone test measured at most 85 ms in the latest isolated run, with a 150 ms observation under concurrent local load. A separate fix restores opt-out semantics for silence detection at zero. The combined Phase 7 fixture exercises the native scene, the direct MPEG-TS URL, actual portable OBS, and browser refresh and closure in isolated staging.
