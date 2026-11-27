# Implementation progress

2026-11-26. UI-001 simplifies the OBS graphics editor and filters sidebar links by session permissions. Removed the static operator identity. The frontend build and both frontend tests passed, and the conditional UI states were reviewed in source. Rollback consists of reverting the four frontend edits and the UI-001 documentation records. The change requires no data migration.

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

## IPTV deployment preparation

Added an opt-in Linux Compose configuration with the GStreamer Program runtime, a separate FFmpeg HLS packager and an HTTPS Nginx location for one public channel. The packager shares the Program network namespace for local UDP and passes through H.264 and AAC. The existing SQLite volume retains application data.

Both application builds and 27 repository tests passed with isolated SQLite. Shell syntax and static YAML wiring passed. Docker Compose rendering, image builds and independent HLS playback remain pending on a Linux Docker host. No deployment was performed. Roll back by stopping the HLS service and returning to base Compose with the same project and SQLite volume. See the [IPTV deployment guide](IPTV_DEPLOYMENT.md).

Fixed contribution readiness when silence detection is disabled. Before the change, stereo silence blocked Take even at a zero timeout. After the change a loopback sender with video and silent AAC reached ready, and an independent HLS receiver decoded moving frames after Take. FFmpeg reported a video timestamp warning at the switch. Reverting the worker guard restores the previous behavior.

Multiview now displays the Independent Program status and picture for an active worker, even when the OBS Agent is offline. Program displays the composed output and Preview displays the primary input. Both use existing station-scoped reads. The local browser verified both views on the test station and retained OBS status on unconfigured stations. Revert the Multiview change and restore the frame hook to Live Control to roll back.

Reduced dashboard polling during live operation. Hidden tabs pause Program and OBS preview reads and station synchronization. These reads honor HTTP 429 retry timing and retain the last result during throttling. The session check retries a 429 without opening the sign-in form. Local verification covered the Program monitor with the advertising panel open and the hidden-tab and retry regression test. The API limits are unchanged. Roll back the frontend polling and session changes together.

Moved Independent Program ads, watermark and ticker to Graphics & Overlays, saved scenes to Sources & Scenes, and mute and gain to Audio Mixer. Live Control retains monitors, source switching and session controls. The news ticker stores a revision per station and scrolls Arabic or Latin text over the encoded output, with adjustable speed and direction. Applying or hiding the strip does not restart Program.

Both builds and 28 repository tests passed. The isolated ticker loopback verified access checks, stale revision rejection, text motion and removal on decoded video within one session. The local browser verified the relocated controls on station test. Roll back the page moves together and disable the ticker before reverting its route, controller and worker changes. The additive SQLite table can remain in place.

Sources & Scenes now streams MP4 uploads up to 128 MiB and 60 seconds, prepares the video for Program, and selects the result in a new draft. The overlay image is optional. The existing ad upload route retains its original limits and shares the station media library. Uploads do not change the on-air source before Take.

Both builds and 28 repository tests passed. An isolated SQLite runtime accepted the supplied 93,904,507-byte MP4, saved and previewed a video-only scene, and an independent FFmpeg receiver decoded the moving Program output. The browser displayed the upload and optional overlay controls on station test. Revert the source upload route, scene settings and UI changes together. Before reverting support for video-only scenes, add an overlay to any such saved scene that must remain usable on the earlier version.

Live Control now places a Take button beside each configured input and marks the active input On air. A direct secondary Take is station-authorized, audited and restored after runtime restart. The isolated control-restart receiver passed with MCR_TEST_SECONDARY=1. The local browser took OBS on the secondary input and verified the running Program status.

The HLS packager now targets one-second segments. Local playback used a two-segment live target and measured two seconds behind the newest published segment while playing 720p. Capture-to-screen latency was not measured. Roll back the selection UI and API together. Restore the previous HLS segment duration and player target if clients need the prior buffer.

Added a Video input tile to Live Control. Operators can select or upload a station video, preview it muted and take it directly to Program with its source audio. It uses the existing local scene worker and saved source recovery without creating a named scene. The selected asset shows On air when it matches the current Program video.

Both builds and 28 repository tests passed. The isolated upload loopback checked authentication, a missing asset, direct Take in the same Program session and independently decoded video. The local browser selected another clip for preview while the current Program continued. To roll back, revert the Video input tile and direct Take route. Existing uploads remain in the station library.
