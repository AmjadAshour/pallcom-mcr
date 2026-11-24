# Phase 7 · Staging broadcast acceptance

**Disposition: Failed for the full requested workflow.** Independent Program passed its implemented slate/OBS broadcast path with live graphics, ads and receiver-decoded audio. Two required operator actions are missing: creating a native scene containing a video and an image, and previewing/taking a second scene from a registered external URL. A further difference from the architecture target is that terminating the control service also ends its worker session.

Tested 24 November 2026 on local Windows staging, revision `ba5a1f0` plus the watermark fix below. The API ran as a separate Node process against disposable SQLite. Chrome operated on the built frontend. A portable OBS Studio instance used a private profile, synthetic red video and 880 Hz audio. Every media connection used loopback. The operator steps are in the [quick guide](STAGING_OPERATOR_GUIDE.md).

## Broadcast evidence

A separate FFmpeg process received MPEG-TS, recorded the encoded stream, decoded picture samples at 4 Hz and measured a mono PCM downmix of the received audio. ffprobe confirmed H.264 1280×720 and stereo AAC at 48 kHz in all three recordings. The sample log covers 179 observations. The deliberate receiver shutdown and service restart divide the capture into three segments. The audio evidence is decoded signal measurement. Physical speaker playback, lip-sync and every-frame watermark continuity were outside this check.

| Scenario | Status | Observed evidence or exact dependency |
|---|---|---|
| Start MCR and Program with OBS closed | Passed | Process preflight found no running OBS. The receiver decoded the blue slate, green watermark and silence. |
| Create and take a native video-plus-image scene | Failed | With the Agent offline the scene inventory returned HTTP 503. The independent Program action schema rejected a scene action with 400. Its two source selectors are slate and the OBS contribution. A native scene model, local video input and layer take are missing. |
| Preview and take a supported external-URL scene | Failed | There is no independent URL source registration, Preview bus or URL scene take in this revision. The Preview images for watermark and ad editing show the selected source. They cannot cue a second input. |
| Unavailable URL interrupts an active URL scene and triggers fallback | Not Run | An unavailable URL cannot be assigned to an on-air source. The local rejection test below exercises the admission boundary only. |
| Global watermark throughout the captured source changes | Passed | All 179 receiver samples contained the green logo at its expected position, including the OBS take, disconnect, manual retake, black-source test and restart. Inspected a decoded OBS frame with the watermark and ad visible. The dedicated receiver regression also passed all four anchors, opacity, disable and restart. |
| Two simultaneous placements with separate playlists | Passed | Left placement used 20% × 18% and alternated a yellow image with a video. Right used 16% × 20% and alternated magenta and yellow images. Their display durations, gaps and motion differed. Receiver samples contained both creatives simultaneously. A second receiver run decoded 328 frames. Its 3.6-second cycle measured 90 frames, including 25 video-ad frames. The 600 ms and 400 ms gaps measured 16 and 10 frames. Both rectangle bounds, stacking, fade and movement checks passed. |
| Connect actual OBS and take live | Passed | After the healthy-media gate, Take OBS produced red video, PCM RMS 0.088 and approximately 890 Hz by short-window zero-crossing count for the 880 Hz source. |
| Stop OBS, fall back, reconnect and retake | Passed | Stopping the portable process produced blue video and RMS zero. Reconnect reached Ready and left the slate selected. Explicit retake restored red picture and tone. The session ID held across both takes. |
| Missing media file inside the OBS contribution | Passed | Temporarily withheld the fixture's local MP4 and launched its isolated OBS profile. OBS still delivered valid black video and silence; the contribution remained Ready. Manual Take slate recovered the picture. The synthetic file was restored. Operators must monitor content as well as transport health. |
| Missing creative in the independent ad library | Passed | Removed only the generated magenta creative's prepared frame in disposable SQLite. After reload its slot was transparent, the next yellow item aired, and all 17 samples in that observation retained the watermark. |
| Missing file in a native scene | Not Run | Requires the missing native scene file input. The OBS-file and ad-library exercises above use different media paths. |
| Lose the output receiver and recover | Passed | Stopped the receiver while OBS was on air. The encoder continued running. A fresh receiver on the same port decoded red video and tone under the original Program session. The interruption leaves a hole in the receiver recording. |
| Invalid output configuration | Passed | Restarted the API with identical input/output port settings. Start returned 503 and Program stayed stopped. Restored distinct loopback ports and successfully started a new session. |
| Downstream failure alarm or remote destination reconnect | Not Run | The available output is unacknowledged loopback UDP. There is no receiver feedback channel or separately configured remote publishing adapter. |
| Refresh the operator browser | Passed | Reloaded the actual Live Control tab. Stop Program returned to view. The API session ID and marked slate at the receiver persisted. |
| Restart service using the staging runbook | Passed | Terminated and relaunched the API process against the same SQLite database. The full plan, zone, transport anchors and watermark revision matched. Program started explicitly with a new session and produced marked output. |
| Keep Program running through control-service termination | Failed | The architecture target calls for an autonomous worker during control unavailability. The worker entry point quits on parent pipe closure. The relaunched service reported stopped and required an explicit start. The duration of the interruption was not measured. |

## Builds, defensive checks and repair

| Check | Status | Evidence |
|---|---|---|
| Web and server builds | Passed | `npm run build:web` and `npm run build:server` completed after the fix. |
| Repository lint | Not Run | Invoked `npm run lint`; npm returned “Missing script: lint”. No workspace lint script or repository lint configuration was found. Supplemental syntax checks parsed 80 JS/MJS files and the Python worker. |
| Repository test suite | Passed | `npm test` passed all 27 tests using temporary SQLite, including the new opacity regression. |
| Upload handling | Passed | Corrupt image and MP4 uploads returned 400. Valid PNG and MP4 creatives were accepted and aired. A valid RGB watermark initially failed, then passed after repair. |
| External URL admission | Passed | A start request containing an unsupported URL field returned 400. The instrumented loopback HTTP endpoint recorded zero requests. |
| Registered URL redirect, nested playlist and allowed-host policy | Not Run | There is no network URL ingestion adapter to exercise. |
| Authorization and tenant isolation | Passed | Unauthenticated Program read returned 401, viewer start returned 403, and another organization's admin received 404 for the ad resource. |
| Credential handling | Passed | Station response exposed only a password-presence flag. Session rotation, revocation, encryption and the built-bundle forbidden-pattern checks passed in the repository suite. Test credentials and pairing data stay outside the report. |

**Repair.** Sharp applied the four-channel opacity operation to some three-channel inputs before alpha expansion. The watermark renderer now materializes a bounded RGBA buffer before scaling alpha. A targeted regression checks RGB PNG, JPEG and an existing half-transparent PNG at 50% opacity. The combined broadcast and the dedicated receiver watermark test both passed after this change. To roll back the renderer, revert its change and its associated regression test together. This restores the RGB input defect.

## Reproduction and retained evidence

1. Build the frontend and prepare the GStreamer interpreter and FFmpeg tools in the [staging runbook](INDEPENDENT_PROGRAM_STAGING.md). Reserve UDP 25100 for the OBS contribution and 25402 for delivery. Close OBS before starting the fixture.
2. Use a disposable Windows OBS portable copy under a temporary directory beginning with `pallcom-obs-`. Its profile and scene collection must both be named `McrFixture`. Configure custom FFmpeg recording to URL, MPEG-TS, H.264/AAC and `udp://127.0.0.1:25100?pkt_size=1316`. Its scene must play a looping local `fixture.mp4` in the root of that copy, with solid red picture and 880 Hz tone. The test temporarily renames and restores that file. Set `MCR_TEST_OBS_DIR` to the disposable copy, `MCR_PROGRAM_PYTHON` to the staging interpreter, and `MCR_TEST_PLAYWRIGHT` and `MCR_TEST_CHROME` to the installed automation module and browser.
3. Run `node backend/verification/staging-acceptance.js`. It generates its own API port, database, station, users and secrets. The artifact directory is printed on startup. Run `node backend/verification/ads-loopback.js` and `node backend/verification/watermark-loopback.js` separately for their geometry and timing gates.

The final combined run is in the host temp directory `mcr-phase7-kagYXb`. Retain the observations and captures for replay. The repository contains the procedure and measurements; the binary media remains in local staging.

| Artifact | Evidence | SHA-256 |
|---|---|---|
| observations.json | 179 picture/audio samples and named checkpoints | 810fe224bf613a7cbd23a9772171ebb077fed6af78f98d7c08737df3a2fe6de9 |
| program-1.ts | Cold start, browser refresh, first OBS take, loss and manual return; 25.086 s | 52b914b1a84e163551eccc413bac1ec11abbbbea7ef6f24b1c4539fb6be58cb7 |
| program-2.ts | Receiver rejoin, missing-file contribution and slate recovery; 15.198 s | a72a217cf39b2aa55567d2aa58ed4850d3b46c90de29e5bc0ec3f63df6d9b0dc |
| program-3.ts | New service session and missing creative; 3.205 s | 9a87146206abfcad0e14a5998f65a1965b665ebc1a7cca235688cf8b99d10cdb |
