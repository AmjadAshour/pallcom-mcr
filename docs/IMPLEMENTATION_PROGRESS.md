# Implementation progress

2026-11-24. Phase 00 baseline and the initial phases 01â€“02 control-plane slice. All 20 pre-change tests passed against a temporary SQLite path. Existing README and Windows Agent worktree edits were noted before work. The development slice changes only the server Agent gateway, station status, tests and planning documents. No deployment was performed.

The post-change suite passed 21 tests on Node.js 22. GATES:G1 passed simulated heartbeat loss, telemetry expiry/recovery, validation, and command backlog handling. GATES:G2 passed the authenticated Agent tunnel, cross-tenant checks, OBS acknowledgement simulation, and playout regressions. GATES:G3 records the manual documentation comparison.

The first-slice security review found that Agent command result schemas, credential rotation/revocation, enrollment and MFA still need follow-up. No actual OBS output or broadcast continuity was measured. See the [task register](TASKS.md) and [acceptance gates](../GATES.md).

## Continuation â€” P0-003A

Added scoped credential generations and revocation, old-socket disconnection, expiry, atomic pairing-code invalidation and audit logging. Legacy credentials continue until each station is rotated. Added the Settings action and updated the operational instructions.

`npm test` passed 21 tests using temporary SQLite. `npm run build:web` and `npm run build:server` passed. `npm audit --package-lock-only --omit=dev` reported zero known findings. Both [credential acceptance gates](AGENT_CREDENTIAL_GATES.md) passed. No real broadcast, production rollout, or hardware acceptance test was performed.

Next P0 task: split MFA enrollment/recovery from audit tamper resistance and start with MFA for privileged users. Keep Agent command-result schemas and a longer enrollment token tracked before enabling independent network-facing workers.

## Monitoring and replay controls â€” Modules 21 and 08

Multiview displays averaged OBS stream bitrate from output byte and duration deltas and sampled peak dBFS per named OBS input. A reconnect, a stopped stream, or invalid counters clear the measured bitrate. Stale meter samples are omitted. Operators can start, stop, or save the configured OBS replay buffer through station-scoped, audited commands. OBS save events update the last-save timestamp without exposing a local file path.

These controls require an updated station Agent. OBS must have Replay Buffer enabled in its Output settings. Clip playback, advanced replay editing, and a separate encoding worker remain pending. No live output settings were changed.

## Operator-facing slice â€” Module 21

Multiview now presents sortable station tiles, responsive column presets, Program and Preview snapshots, and fullscreen. Preferences are scoped to the dashboard user and organization in browser storage. The existing station-scoped snapshot endpoints remain the media source, with no new broadcast commands.

`npm run build:web` passed. Local Chrome with synthetic station responses confirmed drag-and-drop, bus selection, preference persistence and fullscreen. Actual OBS output, measurement of capture latency, larger deployments, audio meters and independent encoded multiview remain unverified or unimplemented. Rollback is limited to the Multiview page and these documentation updates.

## Independent Program initiative â€” Phase 1 audit

The [implementation specification](INDEPENDENT_PROGRAM_SPEC.md) traces current signals, proposes service and timing contracts, and defines receiver acceptance gates. Four existing simulated playout and bitrate tests passed locally. Deployment identity and actual Program output remain unverified. Rollback consists of removing the specification and this progress entry.

## Independent Program initiative â€” Phase 2

A single opt-in station can start and stop a separate GStreamer worker and select a loopback OBS contribution. A real portable OBS sender and an independent receiver exercised loss, fallback and manual return. A separate Chrome run captured output after closing the operator tab. See the [staging instructions, evidence and rollback](INDEPENDENT_PROGRAM_STAGING.md).

## Independent Program initiative â€” Phase 4 watermark

Implemented against the Phase 2 worker and its 720p output profile. A clean image sampled before the watermark supplies the editor Preview. A revision-checked apply stores the station settings and emits the final overlay after source selection. The local receiver fixture checked a 2:1 uploaded image, inset, opacity, source changes, signal-loss fallback, disabling and restart. The Chrome check exercised pending edits and explicit apply. See the [staging runbook](INDEPENDENT_PROGRAM_STAGING.md) for reproduction and rollback.

## Independent Program initiative â€” Phase 5 advertising

Added a station-scoped image/video library, four independent placement playlists and revision-checked Preview/Apply and live controls. The broadcast scheduler persists timing and override state in SQLite. Receiver testing exposed a one-frame overlap glitch at a lower placement's gap; keeping each placement in a stable layer fixed it. Clock tests cover scheduled eligibility, rotation, simultaneous starts, overrides, restart and DST. The local 720p25 receiver measured a 90-frame cycle (3.6 seconds), decoded the short video repeating, and confirmed the upper placement stayed visible. See the [staging procedure and rollback](INDEPENDENT_PROGRAM_STAGING.md).

## Independent Program initiative â€” Phase 7 staging acceptance

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

Added opt-in silence detection for decoded contribution audio at âˆ’60 dBFS RMS. The loopback receiver fixture confirmed fallback while the sender remained connected, blocked Take during silence, and a manual retake after healthy audio returned. Roll back operationally with MCR_PROGRAM_SILENCE_SECONDS=0.

The independent contribution reports input RMS in dBFS before Take. The loopback receiver fixture verified tone, silence, recovery and clearing on disconnect. The meter also runs when silence fallback is disabled.

Added a separate pre-encode Program RMS meter. The loopback fixture verified silent Program with incoming tone, tone after Take and silence after fallback.

Added session-scoped Program mute/unmute before encoding with station-control authorization. A separate UDP decoder verified silence and restored audio without a Program session change. FFmpeg reported non-monotonic audio timestamps around source retake during the same run. The receiver assertions, both builds and all 27 repository tests passed.

Program now timestamps all PCM from a single sample counter. A bounded contribution queue supplies that clock, with silence on underrun. Receiver checks passed source loss, retake, mute and unmute without the previous backwards audio timestamp warnings. Local scene and recording checks also passed. Long-run A/V drift remains unmeasured.

Added an audited Program attenuation control from âˆ’30 to 0 dB. Local receiver PCM verified a âˆ’12 dB change and restoration within the same session.

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

## Main branch integration

Combined IPTV Live Controls and Program Readiness. Both application builds and all 28 repository tests passed with isolated SQLite and simulated OBS acknowledgements. The combined media loopback fixtures require a GStreamer environment and remain pending.

To roll back the integration, revert the merge with the IPTV branch as its first parent, then revert the IPTV changes separately if the previous main behavior is required. Preserve a SQLite backup before any runtime downgrade. See the feature-specific rollback steps above.

## Live Control cleanup

Moved Independent Program input routing and attenuation to Audio Mixer alongside the existing output controls. Removed the fixed resolution and always-on live badges from the OBS monitors. Live Control retains the input and output readings and the streaming state in the header.

The frontend build and frontend tests passed. To roll back, revert the changes to IndependentProgram, ProgramAudioControls and LiveControlPage together.

## Browser-based Program setup

Live Control lets a station manager assign the SQLite-backed Program engine to a station. The selection persists and takes precedence over the initial MCR_PROGRAM_STATION_ID configuration. The server checks station ownership and permissions, audits changes, and refuses to move an active engine or take an engine assigned to another organization. Scene scheduling follows the selected station.

Video Preview and Program output share the main workspace. The OBS monitor and transition controls are available in an expandable panel when the station is ready. Both builds and all 28 tests passed with isolated SQLite. The simulated OBS integration verifies saved selection and rejection of viewers and out-of-organization access.

To roll back, revert the Program selection API, scheduler and Live Control changes together, then use MCR_PROGRAM_STATION_ID for the intended station. The additive selection table can remain in SQLite.

## Native workspace cleanup

Grouped navigation by broadcast work, administration and optional OBS integrations. Station creation no longer asks for OBS credentials. Removed duplicate recording and streaming controls from station cards, moved the OBS emergency cut into its connected controls, and removed the static uptime figure. Page code loads on navigation.

Both builds and 28 repository tests passed. The local browser opened all twelve routes and verified Arabic RTL. The isolated MP4 fixture decoded a native video scene without OBS. See the [inventory, remaining dependencies and rollback](NATIVE_MCR_CLEANUP.md).

## HLS playback on Windows

The Program worker now passes encoded H.264 and AAC samples directly to an isolated HLS graph using bounded queues. This avoids the intermediate MPEG-TS demux. The isolated HLS fixture passed authenticated playback, independent decoding of HLS and UDP audio/video, playlist advancement, and UDP continuity after an HLS writer failure. The local test1 station displayed the session link after restarting Program and returning the video to air.

To roll back, revert the worker HLS branch and start a new Program session. Keep the HLS directory unset to disable the optional branch.

## Temporary IPTV player links

Station operators can issue a one-hour playback URL for the current Program session. A dedicated token audience restricts the URL to HLS playlists and segments. Every request checks the signing session, current role, organization, station and Program session. Keep token-bearing paths out of request logs. Existing dashboard HLS routes still use normal authentication.

Both builds passed. The isolated HLS fixture decoded video and audio through the signed URL without cookies or authorization headers and checked invalid tokens, session mismatch, login-token separation, revocation and stop. To roll back, remove the signed playback route and link button together. Existing dashboard playback routes require no migration.

## Master specification Phase Zero audit

The attachment matches the permanent [master specification](../MASTER_REQUIREMENTS.md) byte for byte. The Phase Zero audit recorded the architecture, upload limit, risks, capacity model and rollback approach. Both builds and 28 repository tests passed. Loopback receiver checks passed MP4, signed HLS, ticker, watermark and advertising. The isolated SQLite restore passed on rerun after a native process shutdown failure. The [test report](TEST_REPORT.md) records pass scope and open coverage.

The [phase tracker](TASKS.md#current-master-specification-tracker) covers all 21 numbered phases. This audit changes documentation only. To roll it back, revert only the Phase Zero documentation additions and tracker section, retaining existing work and fixtures. Phase One awaits explicit owner approval. The separate Phase 17 reference and approval gate remains mandatory.

## Phase One partial security hardening

Added a safe backend environment example and excluded frontend environment injection, sanitized API error responses, rejected cross-site mutations and disabled Nginx access logging on signed IPTV routes. Isolated tests passed and no live broadcast was interrupted. Phase One remains open. See [test evidence and blockers](PHASE_ONE_GATES.md) and [rollback steps](SECURITY.md#phase-one-hardening-slice).

Phase One follow-up added a shared per-process media preparation limit and rechecks permissions before saving uploads. The tests passed. Host quotas, connection-time destination policy, complete secret-history scanning and authorized staging validation remain open. [Security scope and rollback](SECURITY.md#phase-one-media-preparation-controls)

Phase One now enforces a configurable per-station stored-media quota for native scenes and ads. Both builds, all 30 tests and the independent MP4 receiver passed. A redacted local credential check found four values already present in Git; actual rotation and staging validation remain open. See [verification](PHASE_ONE_GATES.md) and [rollback and recovery](SECURITY.md#station-media-quota-and-credential-findings).

## Phase One offline credential rotation rehearsal

Added a rekey mode to the existing SQLite recovery CLI for encrypted OBS station passwords. It publishes a newly encrypted SQLite copy after a successful transaction and integrity check. The source is opened read-only and overwrite is refused. See [operational steps and rollback](OPERATIONS_RUNBOOK.md#offline-station-encryption-rotation-rehearsal).

Both builds, all 30 suite tests, the existing backup and restore fixture, and the new offline rekey fixture passed. Actual credential rotation, re-enrollment, full historical scanning, connection-time egress enforcement and staging verification remain open. No live restart or production data change was made. To roll back the tool, revert its rekey mode and fixture. It does not add schema changes.

Phase One follow-up added a shared per-account upload rate limit and ran a redacted dedicated source and history scan. The server build, all 30 tests and the MP4 receiver passed. One scanner finding corroborated the known credential issue in the environment configuration. Rotation and staging sign-off remain open. [Gate evidence](PHASE_ONE_GATES.md)

Phase One local verification added network credential reuse rejection and a tested public IPv4 egress proxy for HTTPS contribution. Both builds, 34 suite tests, HTTP/HTTPS policy fixtures and the signed HLS receiver passed. Credential cutover, approved staging source interoperability and actual infrastructure sign-off are still blocked. [Security evidence and rollback](SECURITY.md#network-credential-guard-and-https-source-policy)

Phase One follow-up unified browser mutation origin checks in both Express entry points. Both builds, all 34 tests and the split Program MP4 and HLS loopbacks passed. Actual credential cutover and staging acceptance still require the owner's maintenance and staging authorization. [Evidence](PHASE_ONE_GATES.md) and [rollback](SECURITY.md#phase-one-browser-mutation-origin-policy).

Phase One follow-up confined browser login and refresh tokens to HttpOnly cookies and preserved programmatic JSON token responses. Both builds and all 34 tests passed. Phase One remains open pending credential cutover and staging acceptance. [Evidence](PHASE_ONE_GATES.md) and [rollback](SECURITY.md#phase-one-browser-session-token-isolation).

Phase One now verifies oversized JSON and returns a generic response for unsupported body encoding. Both builds and all 34 tests passed. The npm dependency advisory query remains blocked pending approval for external disclosure or access to an internal scanner. [Evidence](PHASE_ONE_GATES.md) and [rollback](SECURITY.md#phase-one-request-body-rejection).

Phase One bounded the audit log API and verified authorization and tenant scope for the read endpoint. Both builds and all 34 tests passed. [Evidence](PHASE_ONE_GATES.md) and [rollback](SECURITY.md#phase-one-audit-log-read-limits).

Phase One added transactional audit logging to the existing administrative account creation route. Both builds and all 34 tests passed, including rollback on an injected event insert failure. [Evidence](PHASE_ONE_GATES.md) and [rollback](SECURITY.md#phase-one-account-creation-audit).

Phase One now emits the CORS allow-origin header only for the configured origin in REST and Socket.IO. Both builds and all 34 tests passed, including loopback preflight and authenticated connectivity checks. [Evidence](PHASE_ONE_GATES.md) and [rollback](SECURITY.md#phase-one-cors-response-policy).

Phase One tightened the production content security policy for dashboard assets and connections. Both builds and all 35 tests passed, including the production-mode loopback response check. [Evidence](PHASE_ONE_GATES.md) and [rollback](SECURITY.md#phase-one-production-content-security-policy).

Phase One added shared receive deadlines to the primary and Program HTTP servers. Both builds, all 35 tests, the split-runtime MP4 receiver and the independent HLS/UDP receiver passed. [Evidence](PHASE_ONE_GATES.md) and [rollback](SECURITY.md#phase-one-inbound-http-deadlines).

Phase One moved ad upload admission ahead of body buffering. Both builds, all 35 tests and the independent advertising receiver passed. [Evidence](PHASE_ONE_GATES.md) and [rollback](SECURITY.md#phase-one-ad-upload-admission).

Phase One expanded the frontend production artifact audit to nested files and source-map references. A fresh synthetic-marker build and all 36 tests passed. [Evidence](PHASE_ONE_GATES.md) and [rollback](SECURITY.md#phase-one-frontend-build-artifact-audit).

Phase One added server-side validation for the station list filters and verified organization scoping with valid filters. Both builds and all 36 tests passed. [Evidence](PHASE_ONE_GATES.md) and [rollback](SECURITY.md#phase-one-station-list-filter-validation).

Phase One added organization checks for new and changed station studio assignments. Both builds and all 36 tests passed. [Evidence](PHASE_ONE_GATES.md) and [rollback](SECURITY.md#phase-one-station-studio-organization-scope).

Phase One separated the per-IP budgets for login and Agent pairing claims. Both builds and all 36 tests passed, including a valid login after the pairing limit was reached. [Evidence](PHASE_ONE_GATES.md) and [rollback](SECURITY.md#phase-one-independent-login-and-pairing-limits).

Phase One added administrative response cache protection and strict account creation validation. Both builds and all 36 tests passed. [Evidence](PHASE_ONE_GATES.md) and [rollback](SECURITY.md#phase-one-administrative-response-and-write-policy).

Phase One added bounded refresh-token validation before JWT processing. Both builds and all 36 tests passed, including JSON and cookie refresh. [Evidence](PHASE_ONE_GATES.md) and [rollback](SECURITY.md#phase-one-refresh-request-validation).

Phase One added an explicit deny for unrecognized REST roles and exercised the role matrix on five routes. Both builds and all 36 tests passed. [Evidence](PHASE_ONE_GATES.md) and [rollback](SECURITY.md#phase-one-rest-role-checks).

Phase One applied the shared station-read permission to dashboard socket admission and verified tenant-scoped subscriptions. Both builds and all 36 tests passed. [Evidence](PHASE_ONE_GATES.md) and [rollback](SECURITY.md#phase-one-dashboard-socket-authorization).

Phase One extended HLS privacy headers to authorization responses and preserved them through the internal Program proxy. Both builds and all 36 tests passed. The independent receiver passed on rerun. [Evidence](PHASE_ONE_GATES.md) and [rollback](SECURITY.md#phase-one-hls-response-privacy).

Phase One extended the recovery fixture to verify restored station ownership and audit history. Backup, restore and offline rekey passed on isolated SQLite. Both builds and all 36 tests passed. Reverting this fixture and the corresponding documentation does not affect production data or runtime code. [Evidence](PHASE_ONE_GATES.md) and [operating procedure](OPERATIONS_RUNBOOK.md#master-specification-evidence).

Phase One enforced strict write schemas for station creation and settings. Both builds and all 36 tests passed. [Evidence](PHASE_ONE_GATES.md) and [rollback](SECURITY.md#phase-one-station-write-schemas).

Phase One enforced an explicit login field list and password length ceiling. Both builds and all 36 tests passed. [Evidence](PHASE_ONE_GATES.md) and [rollback](SECURITY.md#phase-one-login-request-bounds).

Phase One unified CSV text handling for the audit and schedule exports. Both builds and all 37 tests passed. [Evidence](PHASE_ONE_GATES.md) and [rollback](SECURITY.md#phase-one-csv-export-text-handling).

Phase One tightened temporary video creation and cleanup. Both builds, all 37 tests and split-runtime upload and playback verification passed. [Evidence](PHASE_ONE_GATES.md) and [rollback](SECURITY.md#phase-one-temporary-media-cleanup).

Phase One added a current organization check to scheduled automation dispatch. Both builds and all 37 tests passed. [Evidence](PHASE_ONE_GATES.md) and [rollback](SECURITY.md#phase-one-scheduled-automation-organization-scope).

Phase One corrected audit attribution for manual macro runs while preserving scheduled attribution. Both builds and all 37 tests passed. [Evidence](PHASE_ONE_GATES.md) and [rollback](SECURITY.md#phase-one-manual-automation-audit).

Phase One made automation cancellation and its audit event atomic. Both builds and all 37 tests passed, including rollback and concurrent requests. [Evidence](PHASE_ONE_GATES.md) and [rollback](SECURITY.md#phase-one-automation-cancellation-audit).

Phase One made automation creation and its audit event atomic. Both builds and all 37 tests passed. [Evidence](PHASE_ONE_GATES.md) and [rollback](SECURITY.md#phase-one-automation-creation-audit).

Phase One added validated ingress proxy addresses for Express client attribution. Both builds and all 38 tests passed. [Evidence](PHASE_ONE_GATES.md) and [deployment and rollback](DEPLOYMENT.md#phase-one-explicit-proxy-trust).

Phase One extended proxy verification to inspect login audit entries generated through a real local HTTP proxy. Both builds and all 38 tests passed. [Evidence](TEST_REPORT.md#phase-one-loopback-proxy-audit-attribution).

Phase One added isolated TLS staging with Chromium, secure HTTP and WSS sessions and the real Agent CLI against simulated OBS. The backend now refuses unsupported storage modes instead of silently selecting SQLite, and the fixture expanded station read authorization coverage. Both builds and all 39 tests passed. Public proxy and privilege sign-off, real OBS, dependency advisories and credential cutover remain open. [Consolidated evidence](TEST_REPORT.md#phase-one-consolidated-local-staging-evidence) and [rollback](DEPLOYMENT.md#phase-one-local-staging).

## 2026-11-27 â€” Post-audit Phase One

Baseline HEAD was `c3ab678307f2994f35dbb33f2e0a67efbbe237c3` with 89 pre-existing status entries. This checkpoint describes the working tree. Reproduce from an approved immutable snapshot before release. Current production targets and the proposed sequence are in the master requirements and development plan. [Tests](TEST_REPORT.md) آ· [Release gates](SECURITY_RELEASE_GATES.md)

## Phase Two local authentication and accounts

Implemented self-service profile, password and session controls, scoped account creation, activation and role editing with administrator password reauthentication, inactive-account login-attempt audit monitoring (`LOGIN_FAILED` with generic 401 responses), optional TOTP with recovery codes, sidebar access to Account and Sessions (`/settings`) for all authenticated roles, bilingual Arabic/English Users & Permissions controls, and password recovery through a private loopback delivery contract. Both builds, all 43 workspace tests (including 14 non-viewer granular permission denial assertions), the SQLite rekey fixture, and the headless Chromium browser verification fixture (`account-browser-loopback.js`) passed. Delivery through an actual mail provider and deployed acceptance remain blocked on external mail transport configuration (`MCR_PASSWORD_RESET_DELIVERY_URL`), and MySQL persistence remains Phase 15 scope. Previous Phase One operational gates remain open. [Test evidence](TEST_REPORT.md#phase-two-local-account-verification) آ· [Security and rollback](SECURITY.md#phase-two-accounts-and-authentication)

## Phase One OBS control tenant isolation and Agent RPC result schemas

Enforced organization ownership checks and audit logging on the OBS audio volume, audio mute and studio-mode transition endpoints, made station create/update/delete transactions atomic with their audit events and full dependent-table cleanup, added transactional and organization-scoped audit logging to legacy graphics, playout schedule/scan/control, native Program scene/schedule and signed IPTV playback-link mutations, tightened OBS control, automation, playout and legacy graphics write schemas with `.strict()`, expanded the REST role matrix to 48 assertions across eight routes, hardened `programInputConfig` and `createProgramEgressProxy` against non-public/metadata/IPv6/local HTTPS source hostnames, hardened Electron IPC origin forwarding, set `build.sourcemap: false` in Vite, and added per-command `COMMAND_ACK` result validation (`SEC-004`) in `AgentGateway` to strip unapproved host fields (`file`, `outputPath`) and reject malformed command acknowledgements with HTTP 502. Both builds, all 43 workspace tests, the SQLite recovery/rekey/cutover fixtures, the local TLS/Chromium/Agent staging fixture and the split-runtime upload, audio-monitor and HLS/UDP continuity fixtures exited 0. Rollback reverts the controller, repository and route checks, strict schema refinements, destination hostname guard, Electron IPC and Vite config updates, gateway result schemas and corresponding regression assertions together. [Gate evidence](PHASE_ONE_GATES.md) آ· [Security and rollback](SECURITY.md#phase-one-obs-control-ownership-and-agent-rpc-result-schemas)

## Phase Three professional media library and large file upload system

Implemented a centralized, filesystem-backed Media Library and resumable chunked upload system (`backend/src/infrastructure/media/storage-manager.js`, `upload-service.js`, `media-processor.js`, `sqlite-media-repository.js`, `backend/src/presentation/routes/media.js` and `frontend/src/pages/MediaLibraryPage.jsx`) behind the database-agnostic `IMediaRepository` interface with matching MySQL schema definitions in `backend/database/prisma/schema.prisma`.

- Supports all 12 broadcast categories (`MOVIES`, `TV_PROGRAMS`, `VIDEO_CLIPS`, `MUSIC`, `AUDIO_RECORDINGS`, `ADVERTISEMENTS`, `PROMOTIONS`, `INTROS_OUTROS`, `FALLBACK`, `IMAGES`, `CHANNEL_LOGOS`, `GRAPHICS`), folders, tags, channel associations, server-side pagination/filtering/sorting, video/audio playlists, JPEG thumbnails and HTTP 206 byte-range previews.
- Streams multi-gigabyte uploads in bounded chunks directly to `<MCR_MEDIA_STORAGE_ROOT>/uploads` with atomic organization quota reservations, free-disk headroom enforcement (HTTP 507), duplicate-chunk/offset verification (HTTP 409 with `Upload-Offset`), pause/resume/cancel, session expiration cleanup, backend restart recovery, and full-file SHA-256 integrity verification.
- Validates actual file contents via magic-byte inspection and asynchronous FFprobe/FFmpeg decode checks (`UPLOADING` -> `UPLOADED` -> `VALIDATING` -> `PROCESSING` -> `READY` / `FAILED` / `QUARANTINED`), classifying broadcast compatibility (`DIRECT_PLAYBACK`, `REMUX_REQUIRED`, `TRANSCODE_REQUIRED`, `UNSUPPORTED`) and quarantining spoofed files.
- Supports controlled server-directory imports (`MCR_MEDIA_IMPORT_DIR` with path-traversal and symlink rejection) and SSRF-protected direct HTTPS URL imports (with redirect, metadata IP and private network denial).
- Enforces reference-locked deletion (`confirm=true`, blocking assets referenced by active broadcasts, schedules, scenes, ads, playout plans or playlists) with transactional `MEDIA_ASSET_DELETED` audit logging.
- Both builds, all 44 workspace tests, the legacy scene upload regression, and `backend/verification/media-library-loopback.js` (verifying a **1.05 GiB (`1,081,190,040`-byte)** Full HD `1920x1080` MP4 upload across a mid-upload backend restart, a **180-second** Full HD video, and **129 uninterrupted decoded broadcast frames** during concurrent upload and processing) exited 0. [Architecture](MEDIA_LIBRARY_ARCHITECTURE.md) آ· [Test evidence](TEST_REPORT.md#phase-three-media-library-and-large-upload-verification) آ· [Security](SECURITY.md#phase-three-media-library-and-resumable-uploads)

## Phase 15 MySQL persistence foundation and Phase Four unified video source management

Implemented the Phase 15 MySQL persistence foundation (`backend/src/infrastructure/database/mysql-prisma.js`, `backend/src/infrastructure/repositories/prisma-repositories.js`, `backend/src/infrastructure/repositories/prisma-station-repository.js`, and `backend/scripts/sqlite-to-mysql-migration.js`) and tested it against the local MariaDB/MySQL server (`10.4.32-MariaDB` on `127.0.0.1:3306`), then implemented Phase Four Unified Video Source Management (`backend/src/infrastructure/sources/video-source-service.js`, `backend/src/infrastructure/repositories/sqlite-video-source-repository.js`, `backend/src/presentation/routes/video-sources.js`, and `frontend/src/components/VideoSourcesCatalog.jsx` in `SourcesScenesPage.jsx`).

- Supports all 10 required video source types (`UPLOADED_FILE`, `MOVIE`, `PLAYLIST`, `OBS_LIVE`, `HLS_STREAM`, `RTMP_STREAM`, `SRT_STREAM`, `RTSP_STREAM`, `REMOTE_VIDEO_URL`, `SERVER_FILE`) in both SQLite and MySQL repositories.
- Enforces Phase One SSRF/DNS-rebinding protections, protocol allowlists, DRM prohibition, path-traversal denial, and AES-256-GCM secret encryption at rest.
- Probes live stream and file sources via `ffprobe`, tracks resolution, frame rate, video/audio codecs and last connection time, applies bounded exponential retry backoff, transitions exhausted sources to `FALLBACK_ACTIVE`, recovers automatically when a source returns, and prevents deletion of referenced media assets or fallback sources.
- Both builds, all 45 workspace tests, and `backend/verification/mysql-migration-rehearsal.js` exited 0. [Test evidence](TEST_REPORT.md#phase-15-mysql-persistence-foundation-and-phase-four-video-source-verification) آ· [MySQL migration](MYSQL_MIGRATION_PLAN.md) آ· [Security](SECURITY.md#phase-four-video-source-management-and-phase-15-mysql-persistence-controls)

## Phase Five independent audio sources and professional multi-track audio mixer

Implemented the server-side multi-channel audio processing and mixing architecture (`backend/src/infrastructure/audio/audio-mixer-engine.js`, `backend/src/infrastructure/repositories/sqlite-audio-repository.js`, `PrismaAudioRepository` in `backend/src/infrastructure/repositories/prisma-repositories.js`, `backend/src/presentation/routes/audio.js`, `frontend/src/pages/AudioMixerPage.jsx`, and the external PCM bridge in `backend/src/infrastructure/program/worker.py` and `supervisor.js`), plus version-controlled Prisma SQL migration `backend/database/prisma/migrations/20261128_0001_phase15_and_phase05_foundation/migration.sql`.

- Supports all 11 audio source types (`UPLOADED_AUDIO`, `MUSIC_PLAYLIST`, `INTERNET_RADIO`, `ICECAST_STREAM`, `SHOUTCAST_STREAM`, `MICROPHONE_INPUT`, `VIDEO_EXTRACTED_AUDIO`, `OBS_AUDIO_INPUT`, `ADVERTISEMENT_AUDIO`, `FALLBACK_AUDIO`, `GENERATED_SILENCE`) and all 6 routing modes with per-channel isolated `ChannelAudioEngine` state (`Channel 1` vs `Channel 2`).
- Implements real 16-bit 48 kHz stereo PCM mixing (`mixPcmFrameDsp`), per-source linear volume + dB gain + mute, monitoring-only solo (`soloMonitoring` isolated to `monitorMix` so live `broadcastMix` is never muted by control-room soloing), priority-based automatic ducking with smooth attack/hold/release envelope, equal-power crossfading (`crossfadePcmBuffers`), soft-knee peak limiting (`-1.0 dBFS` ceiling), advertisement audio interruption policies, automatic fallback audio takeover on silence/failure, radio stream SSRF/credential validation and FFprobe health probing with bounded exponential backoff, and explicit session-bound microphone activation.
- Both builds, all 46 workspace tests, `backend/verification/mysql-migration-rehearsal.js`, `backend/verification/program-audio-monitor-loopback.js`, and `backend/verification/channel-one-audio-acceptance.js` (verifying continuous independent music audio across 5 video switches, video source failure, audio fallback/recovery, ad break policy, and mic ducking with 0 encoder restarts) exited 0. [Audio architecture](AUDIO_ARCHITECTURE.md) آ· [Test evidence](TEST_REPORT.md#phase-five-independent-audio-sources-and-multi-track-mixer-verification) آ· [Security](SECURITY.md#phase-five-independent-audio-sources-and-multi-track-mixer-controls)

## Phase Six professional server-side multi-channel playout engine

Implemented the server-side multi-channel Full HD (`1920x1080`) GStreamer playout engine (`backend/src/infrastructure/playout/channel-worker.py`, `backend/src/infrastructure/playout/channel-playout-supervisor.js`, `backend/src/infrastructure/repositories/sqlite-channel-playout-repository.js`, `PrismaChannelPlayoutRepository` in `backend/src/infrastructure/repositories/prisma-repositories.js`, `backend/src/presentation/routes/channel-playout.js`, `frontend/src/components/ChannelPlayoutConsole.jsx` in `LiveControlPage.jsx`, and version-controlled Prisma SQL migration `backend/database/prisma/migrations/20261128_0002_phase06_channel_playout_engine/migration.sql`).

- Operates each television channel in an isolated OS GStreamer worker process (`channel-worker.py`) outputting `1920x1080 @ 25fps` H.264 video and `48,000 Hz` stereo AAC-LC audio independently of browser tabs, operator sessions, or OBS connections.
- Supports Channel One automatic sequential live camera rotation (`CAMERA_ROTATION`) with dual-slot `input-selector` switching (`0` encoder restarts), continuous independent Phase Five audio, manual camera switching, temporary camera exclusion, automatic skipping of unavailable cameras, fallback activation/recovery, and per-channel authorized camera VPN allowlists (`validateCameraDestinationWithAllowlist`).
- Supports Channel Two continuous full-length movie playout (`MOVIE_PLAYOUT`) streaming directly from disk via `uridecodebin`, sequential movie queues, inter-movie advertisement break insertion, keyframe seeking, pause/resume, missing/corrupted file skip recovery, and `ACTIVE_BROADCAST` / `CHANNEL_PLAYOUT_REFERENCE` media deletion protection.
- Enforces resource admission controls (`MCR_MAX_CONCURRENT_CHANNELS`, `MCR_MIN_FREE_MEMORY_MB`), optimistic revision concurrency (`409`), circular fallback hierarchy rejection (`400`), `broadcast:emergency` override auditing, and crash-loop-protected automatic worker recovery.
- Both builds, all 47 workspace tests, `backend/verification/mysql-migration-rehearsal.js`, and `backend/verification/two-channel-playout-acceptance.js` (verifying a genuine **2h05m / `7,500.021s` Full HD 1080p MP4 movie** uploaded via resumable chunks, simultaneous two-channel `1920x1080` H.264/AAC outputs, camera rotation, 1-hour movie seek, and `SIGKILL` worker crash recovery) exited 0. [Playout architecture](PLAYOUT_ENGINE_ARCHITECTURE.md) آ· [Recovery plan](WORKER_RECOVERY_PLAN.md) آ· [Benchmarks](PERFORMANCE_BENCHMARKS.md) آ· [Test evidence](TEST_REPORT.md#phase-six-server-side-multi-channel-playout-engine-and-2-hour-full-hd-movie-verification)

## Phase Seven — Remediation & Hardening Checkpoint (2026-11-28)

- **Completed in Phase Seven Remediation Pass:**
  1. Completed end-to-end `MANUAL_SOURCE_OVERRIDE` and `EMERGENCY_OVERRIDE` live playout switching in `channel-playout-supervisor.js` (`_activateSpecificSource`, `triggerManualSourceOverride`, `triggerEmergencySwitch`) and `channel-scheduler.js`, verified by decoded RGB video pixels and uninterrupted independent audio.
  2. Implemented atomic compare-and-set scheduler leases (`acquireSchedulerLease`), stale-owner write fencing (`409 STALE_SCHEDULER_OWNER`), and durable write-ahead occurrence claiming (`claimOccurrence` on `UNIQUE(occurrenceId)`) in both SQLite and Prisma/MySQL repositories.
  3. Added real-time equal-power crossfading (`startCrossfade`) on scheduled `INDEPENDENT_AUDIO` deck switches and continuous 2-frame/tick PCM pumping into `channel-worker.py`, verified by Goertzel/DFT frequency measurements (`440 Hz` -> `1000 Hz` -> `880 Hz` fallback -> `1000 Hz`) with `0` silent gaps.
  4. Upgraded `MultiTrackBroadcastScheduler.jsx` to cover all 29 timeline features and verified it in headless Chrome (`scheduler-browser-loopback.js`).
- **Next Approved Checkpoint:** Stop at the Phase Seven acceptance gate and await explicit owner authorization before starting **Phase Eight — Multi-Track Timeline Scheduler** (`MASTER_REQUIREMENTS.md` Section 13 / `docs/DEVELOPMENT_PLAN.md`).
