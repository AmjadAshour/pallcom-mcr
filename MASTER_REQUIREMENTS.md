# pallcom MCR — Master Development, Security, and Modernization Prompt

## 1. Role and Project Mission

Act as a senior software architect, full-stack engineer, broadcast automation specialist, cybersecurity engineer, database architect, DevOps engineer, QA engineer, and UI/UX specialist.

Your mission is to transform the existing **pallcom MCR** application into a professional, secure, reliable, maintainable, and production-ready television broadcast automation and playout platform capable of continuous 24/7 operation.

The existing application uses:

- React.js for the frontend.
- Node.js for the backend.
- MySQL whenever persistent relational database storage is required.

Work directly on the existing project. Do not create an unrelated replacement application.

The official project name is **pallcom MCR**. Use this exact name consistently throughout the application and documentation.

## 2. Existing Functionality

The project currently includes:

- OBS live stream integration.
- MP4 video uploads with a current 128 MB file size limitation.
- Video playback.
- Live stream playback.
- IPTV output.
- Channel logo functionality.
- News ticker functionality.
- Advertising functionality.

Inspect and verify these features before modifying them.

Preserve existing working functionality. Integrate and improve existing features instead of unnecessarily rebuilding them.

Do not assume that existing functionality is complete, secure, or production-ready until verified.

## 3. Mandatory Priority Order

Follow this priority order throughout the entire project:

1. Cybersecurity and data protection.
2. Broadcast stability and continuity.
3. Functional correctness.
4. Reliability and fault tolerance.
5. Maintainability and scalability.
6. Performance and resource efficiency.
7. User experience and accessibility.
8. Visual design.

Never sacrifice security or broadcast stability to accelerate development or improve visual appearance.

## 4. Mandatory Skills and Development Workflow

Discover, inspect, and use all relevant available Skills for:

- Software architecture.
- React development.
- Node.js development.
- MySQL database design.
- Cybersecurity.
- Secure API development.
- Authentication and authorization.
- Media processing.
- FFmpeg and streaming technologies.
- Automated testing.
- Debugging.
- Performance optimization.
- DevOps.
- UI/UX design.
- Accessibility.
- Browser testing.

Read all applicable AGENTS.md files, repository instructions, Skill documentation, and existing project documentation.

Do not claim to have used unavailable Skills.

If an essential Skill, tool, permission, or dependency is unavailable, report it explicitly.

Divide the project into phases, tasks, and subtasks with clear dependencies, acceptance criteria, and verification procedures.

Create and continuously maintain the following documentation:

- DEVELOPMENT_PLAN.md
- TASKS.md
- ARCHITECTURE.md
- SECURITY.md
- TEST_REPORT.md
- CHANGELOG.md
- DEPLOYMENT.md
- USER_GUIDE.md
- DESIGN_REQUIREMENTS.md
- API_DOCUMENTATION.md
- OPERATIONS_RUNBOOK.md

Use the following task statuses:

- NOT_STARTED
- IN_PROGRESS
- BLOCKED
- IMPLEMENTED_NOT_VERIFIED
- FAILED_VERIFICATION
- VERIFIED_COMPLETE

Never mark a task as VERIFIED_COMPLETE unless its implementation and acceptance criteria have been successfully verified.

Never fabricate progress, test results, completion percentages, or implementation status.

All technical documentation and development task descriptions must be written in English.

## 5. Phase Zero — Repository Audit and Architecture Planning

Before making major changes:

1. Inspect the complete existing repository.
2. Identify frontend and backend architecture.
3. Inspect all routes, pages, components, APIs, services, middleware, database structures, and streaming processes.
4. Inspect the current OBS integration.
5. Inspect the existing IPTV output pipeline.
6. Inspect media upload and storage functionality.
7. Investigate the exact cause of the 128 MB upload limitation.
8. Audit authentication and authorization.
9. Audit secrets management.
10. Identify security vulnerabilities.
11. Identify duplicated, obsolete, unused, or incomplete code.
12. Identify existing media-processing technologies.
13. Inspect infrastructure and deployment configuration.
14. Run existing tests and establish a functional baseline.
15. Identify server CPU, RAM, network, and storage requirements.
16. Establish backup and rollback procedures.
17. Prepare a phased implementation plan.
18. Identify technical dependencies and implementation risks.

Document all findings.

Do not assume that the existing project uses a particular streaming architecture. Inspect it first and select the safest compatible approach.

Do not overwrite unrelated existing changes.

Preserve existing data and configuration.

Require explicit approval before destructive operations, irreversible database changes, or production deployment.

## 6. Phase One — Comprehensive Security Hardening

Security is mandatory throughout every development phase.

### 6.1 Secrets and Environment Variables

Store sensitive server-side configuration exclusively in backend environment variables or an appropriate secure secrets management system.

Sensitive configuration includes:

- API keys.
- Database credentials.
- Database connection strings.
- Private service URLs.
- Internal infrastructure addresses.
- JWT secrets.
- Session secrets.
- Encryption keys.
- SMTP credentials.
- Storage credentials.
- Third-party service credentials.
- Private streaming credentials.
- OBS ingest credentials.
- Private access tokens.

Mandatory requirements:

- Use a backend-only .env file for local development.
- Add .env and sensitive environment file variants to .gitignore.
- Create a sanitized .env.example containing variable names and safe placeholders only.
- Use secure secrets management in production where available.
- Restrict environment file permissions.
- Validate required environment variables during backend startup.
- Never expose secrets to React.
- Never expose secrets through frontend JavaScript bundles.
- Never place secrets in VITE_ or REACT_APP_ environment variables.
- Never expose secrets through public assets.
- Never expose secrets through API responses.
- Never expose secrets through browser storage.
- Never expose secrets through source maps.
- Never expose secrets through logs or error messages.
- Never hardcode production credentials.
- Never commit real credentials to Git.
- Scan the repository and Git history for previously exposed secrets.
- Report exposed credentials without printing their values.
- Require rotation of compromised credentials.
- Scan production frontend builds for accidental secret exposure.

Adding a file to .gitignore does not remove previously committed secrets.

Distinguish public frontend configuration and intended IPTV playback URLs from sensitive credentials and private infrastructure addresses.

Dynamically configured streaming sources may be stored securely in MySQL when appropriate. Encrypt sensitive source credentials at rest using a server-side encryption key.

### 6.2 API and Backend Security

Implement and verify:

- Server-side authentication.
- Server-side authorization.
- Role-based access control.
- Granular permissions.
- Strict input validation.
- Request schema validation.
- Parameterized SQL queries or secure ORM usage.
- SQL injection protection.
- XSS protection.
- CSRF protection where applicable.
- Strict CORS configuration.
- Content Security Policy.
- Secure HTTP headers.
- HTTPS/TLS support.
- API rate limiting.
- Brute-force protection.
- Request size limits.
- Request timeouts.
- Secure error handling.
- Protection against insecure direct object references.
- Protection against mass assignment.
- Dependency vulnerability scanning.
- Secure audit logging.
- Least-privilege service accounts.
- Least-privilege database accounts.
- Protection against unauthorized administrative actions.
- Resource exhaustion protection.

Never rely on frontend restrictions as a security boundary.

Every protected backend endpoint must independently verify authentication and authorization.

### 6.3 Media and Streaming Security

Implement:

- Secure OBS ingest authentication.
- Stream key rotation and revocation.
- Configurable IPTV access protection.
- Signed or expiring playback tokens where appropriate.
- Protection against unauthorized stream publishing.
- Protection against unauthorized media access.
- SSRF protection for external media URLs.
- DNS rebinding protection.
- Redirect validation.
- Protocol allowlisting.
- Network destination validation.
- Protection against unauthorized access to private networks.
- Protection against access to cloud metadata endpoints.
- Path traversal protection.
- Secure file upload validation.
- Actual media-content validation.
- Storage quotas.
- Upload rate limiting.
- Media-processing resource limits.
- Process isolation.
- Restricted filesystem permissions.
- Secure temporary file cleanup.
- Protection against command injection.

Never concatenate user-controlled values into shell commands.

Execute FFmpeg, FFprobe, or other media processes using safe argument arrays and restricted execution environments.

Do not allow arbitrary user-controlled FFmpeg arguments.

For legitimate internal streaming sources, require explicitly authorized administrator configuration and narrowly scoped network permissions.

Never log credentials embedded in source URLs.

### 6.4 Infrastructure Security

Inspect and improve:

- Reverse proxy security.
- HTTPS configuration.
- Network exposure.
- Firewall requirements.
- Database network access.
- Service permissions.
- Container security, if applicable.
- Process isolation.
- Backup security.
- Dependency update procedures.
- Security monitoring.
- Production error handling.

Do not expose MySQL directly to the public internet.

Do not run application or media-processing services with unnecessary root privileges.

### 6.5 Security Verification

Perform authorized security testing against the development or staging environment.

Verify authentication, permissions, upload security, SSRF protection, secret exposure prevention, session security, and API protections.

Document all findings and remediation.

Do not claim that the application is completely immune to attacks.

Report remaining risks and unverified security controls.

## 7. Phase Two — Authentication and Account Management

Audit, reorganize, and improve the existing authentication system.

Implement or improve:

- Secure login.
- Secure logout.
- Change password.
- Forgot password.
- Password reset.
- User profile management.
- Administrator account management.
- Operator accounts.
- Role-based permissions.
- Session management.
- Session expiration.
- Session revocation.
- Optional two-factor authentication.
- Login attempt monitoring.
- Security audit history.
- Account activation and deactivation.
- Active session management.

Use Argon2id or appropriately configured bcrypt for password hashing.

Never store plaintext passwords.

Implement secure password-reset tokens with expiration, single-use enforcement, and safe storage.

Protect against:

- Brute-force attacks.
- Credential stuffing.
- Account enumeration.
- Session fixation.
- Session hijacking.
- Unauthorized privilege escalation.

Use secure cookie settings where applicable.

Require appropriate reauthentication for sensitive account changes.

Verify all permissions on the backend.

Provide separate permissions for:

- Viewing broadcast status.
- Managing schedules.
- Publishing schedules.
- Controlling live broadcasts.
- Emergency switching.
- Managing audio sources.
- Managing video sources.
- Uploading media.
- Deleting media.
- Managing advertisements.
- Managing graphics.
- Managing IPTV outputs.
- Viewing logs.
- Administering users.
- Changing system settings.

## 8. Phase Three — Media Library and Large File Management

Create a centralized media management system.

### 8.1 Supported Video Files

Support common media formats, subject to verified media-engine capabilities:

- MP4.
- MKV.
- MOV.
- AVI.
- WebM.
- MPEG-TS.
- Other supported containers and codecs.

Support long-duration videos, television programs, movies, documentaries, and large media files.

Use FFmpeg and FFprobe, or the existing compatible media engine, for media inspection, validation, and processing.

### 8.2 Large File Uploads

Investigate and resolve the current 128 MB upload limitation.

Do not simply increase the request body limit.

Implement:

- Chunked uploads.
- Resumable uploads.
- Multi-gigabyte file support.
- Configurable maximum file sizes.
- Upload progress.
- Upload speed information.
- Pause and resume.
- Failed chunk retries.
- Upload cancellation.
- File integrity verification.
- Recovery after network interruptions.
- Storage quota enforcement.
- Concurrent upload limits.
- Temporary file cleanup.
- Streaming file writes without loading entire files into server memory.

Inspect reverse proxy, application server, storage, and network limitations.

Support importing large media files directly from administrator-authorized server directories.

Support secure remote media imports from authorized direct download URLs.

Prevent unrestricted filesystem browsing.

### 8.3 Media Storage

Store media files in dedicated filesystem storage or compatible object storage.

Use MySQL for metadata, references, ownership, permissions, and scheduling information.

Do not store large video files as MySQL binary objects.

Implement:

- Storage usage monitoring.
- Available disk space monitoring.
- Configurable storage quotas.
- Low-storage alerts.
- Temporary file cleanup.
- Media integrity checks.
- Safe storage migration procedures.

### 8.4 Media Library Features

Implement:

- Media folders and categories.
- Video thumbnails.
- Audio and video previews.
- Search.
- Filtering.
- Sorting.
- File size information.
- Duration detection.
- Resolution detection.
- Frame rate detection.
- Codec information.
- Audio track detection.
- Media availability status.
- Upload and processing status.
- Duplicate detection where appropriate.
- Video playlists.
- Audio playlists.
- Safe media deletion.
- Dependency checks before deletion.

Prevent deletion of media required by active or future schedules unless an authorized replacement workflow is completed.

## 9. Phase Four — Video Source Management

Create a unified video source management system.

Support:

- Uploaded video files.
- Long-duration movies.
- Video playlists.
- OBS live streams.
- External HLS/M3U8 streams.
- RTMP streams.
- SRT streams.
- RTSP streams.
- Direct remote video file URLs.
- Authorized server-side media files.

Support receiving, validating, previewing, scheduling, and rebroadcasting authorized external live streams.

Do not bypass DRM, access restrictions, or source authorization requirements.

Each source should include:

- Source name.
- Source type.
- Secure configuration.
- Connection status.
- Availability status.
- Preview.
- Resolution.
- Frame rate.
- Video codec.
- Audio availability.
- Last successful connection.
- Error information.
- Reconnection settings.
- Fallback settings.

Implement configurable reconnection strategies with bounded retries and backoff.

Validate all source URLs using the security controls defined in Phase One.

Document any protocol-specific limitations.

## 10. Phase Five — Independent Audio Sources and Audio Mixer

Build an independent audio subsystem that can operate separately from video playback.

### 10.1 Supported Audio Sources

Support:

- Live microphone input.
- Uploaded audio files.
- MP3.
- WAV.
- AAC.
- FLAC.
- Other supported audio formats.
- Music playlists.
- Internet radio streams.
- Icecast streams.
- Shoutcast streams.
- Compatible external audio URLs.
- OBS audio.
- Original video audio.
- Audio extracted from external video streams.

For browser microphone input, use secure browser permissions and a suitable real-time audio transport, such as WebRTC where appropriate.

Clearly indicate that browser-based microphone input requires an active browser connection.

Server-side audio sources must continue independently when the operator closes the browser.

### 10.2 Professional Audio Mixer

Implement a professional multi-channel audio mixer with:

- Multiple simultaneous audio sources.
- Independent volume controls.
- Gain adjustment.
- Mute controls.
- Solo controls.
- Master output volume.
- Real-time audio level meters.
- Peak indicators.
- Clipping prevention.
- Audio normalization.
- Configurable audio delay.
- Audio/video synchronization.
- Audio ducking.
- Fade-in.
- Fade-out.
- Audio crossfading.
- Audio routing.
- Source monitoring.
- Source reconnection.
- Configurable fallback audio.

Implement actual server-side audio mixing.

Do not simulate broadcast audio mixing using frontend volume controls only.

### 10.3 Audio Routing Modes

Support:

1. Original video audio only.
2. External audio replacing original video audio.
3. Original video audio mixed with external audio.
4. Multiple external audio sources mixed together.
5. Silent video with independent audio.
6. Microphone commentary over video or live streams.

Allow independent audio to continue without unnecessary interruption when video sources change.

### 10.4 Music Playlist Management

Implement:

- Sequential playback.
- Shuffle playback.
- Repeat playlist.
- Repeat individual track.
- Playlist scheduling.
- Automatic next-track playback.
- Configurable crossfade.
- Track duration information.
- Playlist preview.
- Current and upcoming track information.

### 10.5 Audio Acceptance Scenarios

Verify the following scenarios:

- Play a silent video with a live internet radio stream.
- Play several consecutive videos while the same radio stream continues.
- Play a movie while mixing microphone commentary.
- Replace OBS audio with an external audio source.
- Mix original video audio with background music.
- Automatically reduce music volume when microphone commentary begins.
- Recover from an unavailable radio source using fallback audio.
- Maintain audio/video synchronization during long-duration broadcasts.

## 11. Phase Six — Server-Side Broadcast Playout Engine

Implement or improve a reliable server-side broadcast playout engine.

The television channel must continue operating when:

- The operator closes the browser.
- The operator logs out.
- The frontend is refreshed.
- The operator's internet connection is interrupted.
- An individual media source becomes unavailable.

The broadcast engine must not depend on React timers, browser playback, or frontend state.

Implement:

- Continuous 24/7 operation.
- Persistent broadcast state.
- Server-side scheduling.
- Reliable process supervision.
- Automatic recovery.
- Source preloading where supported.
- Media format normalization.
- Timestamp normalization.
- Audio/video synchronization.
- Controlled source transitions.
- Output monitoring.
- Configurable fallback content.
- Resource management.
- Graceful shutdown.
- Restart recovery.

Prevent duplicate playout workers and duplicate schedule execution.

Use durable scheduling state, appropriate locking, and idempotent operations.

Avoid restarting the output encoder for every source transition where technically feasible.

Preserve the existing IPTV endpoint and maintain a stable output URL.

Measure actual transition interruptions and report them honestly.

Do not claim seamless or interruption-free switching unless verified.

## 12. Phase Seven — Professional Broadcast Scheduler

Build a complete television broadcast scheduling system.

Support:

- Daily schedules.
- Weekly schedules.
- Future schedules.
- Recurring schedules.
- Video scheduling.
- Live stream scheduling.
- Independent audio scheduling.
- Music playlist scheduling.
- Radio stream scheduling.
- Microphone session scheduling.
- Advertisement scheduling.
- Existing graphics scheduling where appropriate.
- Automatic playlist execution.
- Manual schedule overrides.
- Emergency broadcast overrides.

Each scheduled item must support:

- Source.
- Start date.
- Start time.
- End date.
- End time.
- Duration.
- Media trim start.
- Media trim end.
- Priority.
- Repeat configuration.
- Audio routing configuration.
- Fallback configuration.
- Schedule status.

Store schedules persistently in MySQL.

Store timestamps consistently in UTC and display them using the configured broadcast timezone.

Handle timezone changes and daylight-saving transitions correctly.

Support hard-start and flexible-start scheduling policies.

Allow authorized operators to modify upcoming scheduled items without unnecessarily interrupting the currently playing program.

Implement schedule versioning, draft schedules, publishing, conflict detection, and concurrent-edit protection.

## 13. Phase Eight — Multi-Track Timeline Scheduler

Build a professional timeline editor inspired by television automation systems and professional video editing applications.

The timeline must represent actual broadcast time rather than only relative editing time.

### 13.1 Timeline Structure

Provide separate tracks for:

- Main video.
- Original video audio.
- External audio.
- Internet radio.
- Music playlists.
- Microphone commentary.
- Additional audio tracks.
- Existing graphics.
- Existing advertisements.

Allow additional audio tracks where appropriate.

### 13.2 Timeline Visual Information

Display:

- Hours.
- Minutes.
- Seconds.
- Selected date.
- Broadcast timezone.
- Current broadcast time.
- Moving live playhead.
- Current program.
- Upcoming program.
- Scheduled item names.
- Video thumbnails.
- Audio waveforms where practical.
- Exact start times.
- Exact end times.
- Item durations.
- Source types.
- Source availability.
- Scheduling conflicts.
- Empty schedule periods.
- Fallback content.

### 13.3 Timeline Editing Features

Implement:

- Drag and drop.
- Moving clips between compatible tracks.
- Clip trimming.
- Duration adjustment.
- Start and end time editing.
- Copy and paste.
- Item duplication.
- Recurring items.
- Timeline zoom.
- Horizontal scrolling.
- Day navigation.
- Date selection.
- Snapping.
- Undo and redo.
- Multi-item selection.
- Keyboard shortcuts.
- Accessible keyboard alternatives.
- Schedule preview.
- Draft and publish workflow.

Validate all schedule changes on the backend.

Do not rely exclusively on frontend timeline validation.

### 13.4 Conflict and Gap Management

Detect:

- Conflicting video items.
- Invalid source durations.
- Missing media.
- Unavailable live sources.
- Invalid scheduling times.
- Empty video periods.
- Unintended audio gaps.
- Unauthorized source configurations.

Distinguish intentional audio overlaps from invalid scheduling conflicts.

Allow configurable automatic fallback content for schedule gaps.

Never silently modify a published schedule without an authorized policy or operator action.

### 13.5 Timeline Acceptance Scenario

Create and verify a schedule containing:

- Video A from 08:00 to 09:00.
- Video B from 09:00 to 10:00.
- Video C from 10:00 to 11:00.
- An independent internet radio source from 08:00 to 11:00.
- A microphone commentary session from 09:30 to 09:45.

The video sources must change according to their schedule while the radio continues independently.

The microphone must be mixed according to its configured audio routing and ducking settings.

The timeline must accurately display the start time, end time, and duration of every scheduled item.

Verify that actual broadcast output matches the published schedule.

## 14. Phase Nine — Live Control and Broadcast Operations

Create a professional live broadcast control interface.

### 14.1 Preview and Program

Implement two distinct monitoring views:

- Preview: Allows operators to inspect upcoming sources before broadcasting them.
- Program: Displays the actual published broadcast output.

Preview operations must not accidentally modify the live output.

Program monitoring must represent the real broadcast stream, not merely the selected source.

Display audio levels for the actual program output.

### 14.2 Live Switching

Support:

- Manual source selection.
- Previewing sources.
- Taking a preview source to air.
- Switching between uploaded videos and live sources.
- Switching between OBS and external streams.
- Independent audio switching.
- Returning to the scheduled broadcast.
- Authorized emergency overrides.

Define what happens to the schedule during and after manual overrides.

### 14.3 Emergency Broadcast

Implement:

- Authorized emergency switching.
- Emergency video sources.
- Emergency audio sources.
- Emergency live streams.
- Emergency fallback content.
- Explicit return-to-schedule controls.
- Audit logging.

Prevent accidental or unauthorized emergency activation.

## 15. Phase Ten — Fallback, Recovery, and Broadcast Reliability

Implement automatic recovery mechanisms.

Handle:

- OBS disconnections.
- External stream failures.
- Unavailable media files.
- Corrupted media.
- Audio source failures.
- Internet radio disconnections.
- Encoder failures.
- Unexpected worker termination.
- Server restarts.
- Schedule gaps.
- Network interruptions.
- Low storage conditions.

Provide configurable fallback options:

- Backup video.
- Backup live stream.
- Backup playlist.
- Channel standby screen.
- Backup audio.
- Silence when explicitly configured.

Implement:

- Source health checks.
- Reconnection policies.
- Exponential backoff.
- Bounded retries.
- Process supervision.
- Failure alerts.
- Automatic recovery.
- Persistent broadcast state.
- Graceful recovery to the scheduled program.

Avoid infinite restart loops.

Document actual recovery behavior and limitations.

## 16. Phase Eleven — IPTV Output Management

Preserve and improve the existing IPTV output system.

Implement or improve:

- Stable IPTV playback URLs.
- Output status.
- Output availability monitoring.
- Configurable output resolution.
- Configurable video bitrate.
- Configurable audio bitrate.
- Configurable frame rate.
- Configurable encoding profiles.
- Stream health monitoring.
- Authorized playback access.
- Optional public or protected output modes.
- Secure playback token management where appropriate.

Keep playback URLs stable during source changes whenever supported by the architecture.

Avoid exposing internal infrastructure addresses or administrative credentials.

Verify compatibility with representative IPTV players.

Measure playback continuity, latency, and recovery behavior.

Do not promise universal player compatibility without testing.

## 17. Phase Twelve — Existing Graphics and Advertising Integration

The existing application already contains:

- Channel logo functionality.
- News ticker functionality.
- Advertising functionality.

Do not unnecessarily rebuild these features.

Audit and verify their current implementation.

Integrate them with:

- The new broadcast engine.
- The timeline scheduler.
- Live control.
- Preview and Program monitoring.
- Existing IPTV output.
- Audio routing where applicable.

Preserve their working functionality.

Fix security vulnerabilities, bugs, or integration problems when necessary.

Ensure that graphics and advertising operations do not unnecessarily interrupt the broadcast output.

## 18. Phase Thirteen — Electronic Program Guide

Implement an Electronic Program Guide (EPG).

Support:

- Current program information.
- Upcoming program information.
- Program titles.
- Program descriptions.
- Program categories.
- Start and end times.
- Schedule-based EPG generation.
- XMLTV export where appropriate.
- EPG updates following authorized schedule changes.

Ensure consistency between the published schedule and generated EPG.

Clearly distinguish planned schedule information from actual broadcast history.

## 19. Phase Fourteen — Monitoring, Analytics, and Logs

Create a centralized broadcast monitoring system.

Monitor where technically measurable:

- Broadcast status.
- Current video source.
- Current audio sources.
- Current program.
- Upcoming program.
- Output bitrate.
- Frame rate.
- Dropped frames.
- Audio levels.
- Audio clipping.
- Stream availability.
- Encoder status.
- CPU usage.
- RAM usage.
- Disk usage.
- Network usage.
- Worker status.
- Source failures.
- Reconnection attempts.

Implement configurable alerts.

### As-Run Logs

Record actual broadcast events, including:

- Actual program start time.
- Actual program end time.
- Scheduled start time.
- Scheduled end time.
- Source information.
- Audio source information.
- Playback failures.
- Source transitions.
- Manual overrides.
- Emergency overrides.
- Fallback activation.
- Recovery events.
- Authorized operator actions.

Support filtering and exporting logs.

Protect logs from unauthorized modification and access.

Never expose secrets or sensitive credentials in logs.

## 20. Phase Fifteen — Database Architecture

Use MySQL whenever persistent relational storage is required.

Inspect the existing database before introducing new structures.

Design appropriate database entities for:

- Users.
- Roles.
- Permissions.
- Sessions where applicable.
- Media assets.
- Video sources.
- Audio sources.
- Playlists.
- Playlist items.
- Schedules.
- Schedule items.
- Schedule versions.
- Audio routing configurations.
- Broadcast state.
- IPTV outputs.
- Existing graphics configurations.
- Existing advertising configurations.
- EPG information.
- As-run logs.
- Security audit logs.
- System settings.

Use:

- Foreign keys where appropriate.
- Appropriate indexes.
- Transactions.
- Database constraints.
- Parameterized queries.
- Safe migrations.
- Least-privilege database accounts.
- Backup and recovery procedures.

Do not delete existing data without explicit authorization.

Avoid unnecessary database queries and inefficient polling.

Do not store large media binary files directly in MySQL.

## 21. Phase Sixteen — Functional Verification Before Final Redesign

Before starting the final visual redesign, verify the functional implementation.

Run:

- Unit tests.
- Integration tests.
- API tests.
- Database tests.
- End-to-end tests.
- Browser tests.
- Security tests.
- Streaming tests.
- Regression tests.
- Performance tests.
- Recovery tests.
- Long-duration stability tests.

Verify at minimum:

- Authentication and authorization.
- Password management.
- Secret exposure prevention.
- Unauthorized API access prevention.
- Secure file uploads.
- Large-file upload recovery.
- Remote source security.
- Video source switching.
- Independent audio playback.
- Actual audio mixing.
- Timeline scheduling.
- Schedule conflict detection.
- Schedule persistence.
- Browser closure during broadcasting.
- OBS disconnection.
- Radio stream disconnection.
- Fallback activation.
- Process restart recovery.
- IPTV playback continuity.
- Existing logo functionality.
- Existing news ticker functionality.
- Existing advertising functionality.
- EPG generation.
- Actual broadcast logging.

Use real test media and authorized test streams.

Record actual test commands, results, failures, and measurable evidence.

If a test requires unavailable equipment, credentials, infrastructure, or permissions, mark it as blocked or unverified.

Never fabricate test results.

Do not proceed to the final redesign while critical functional or security requirements remain unresolved without explicit owner approval.

## 22. Phase Seventeen — Mandatory Design Approval Gate

**STOP BEFORE STARTING THE FINAL UI/UX REDESIGN.**

This is a mandatory approval checkpoint.

After completing and verifying the preceding functional phases, explicitly ask me to provide the new visual design reference.

Request one or more of the following:

- Design screenshots.
- Reference images.
- Figma design link.
- Reference website.
- Design files.
- Brand guidelines.
- Color palette.
- Typography requirements.

Do not independently select the final visual identity.

Do not independently select final colors, typography, or interface styling.

Do not perform the complete interface redesign before receiving my design reference and explicit approval.

While implementing earlier functional phases, use the existing design system or minimal functional interface changes.

After receiving the design reference:

1. Analyze the provided design.
2. Identify the visual language.
3. Extract the color system.
4. Identify typography.
5. Identify spacing rules.
6. Identify component styles.
7. Identify navigation patterns.
8. Identify dashboard layout patterns.
9. Propose the new information architecture.
10. Present the implementation plan.
11. Wait for my explicit approval.

Do not bypass this approval gate.

## 23. Phase Eighteen — Complete UI/UX Redesign and Page Reorganization

Only execute this phase after receiving the new design reference and explicit approval.

Rebuild and reorganize the entire frontend interface using the approved design.

The objective is not merely to change colors.

The objective is to create a coherent, professional, modern, and easy-to-use broadcast management platform.

### 23.1 Proposed Navigation Structure

Use the following as a starting point, subject to approval:

1. Dashboard.
2. Live Control.
3. Scheduler.
4. Media Library.
5. Sources.
6. Audio Mixer.
7. Graphics and Ads.
8. IPTV Outputs.
9. Monitoring and Logs.
10. Settings.
11. Account and Security.

Consolidate related pages when this improves usability.

Avoid unnecessary navigation levels and duplicated functionality.

### 23.2 Dashboard

Display:

- Channel status.
- Live broadcast preview.
- Current program.
- Upcoming program.
- Active video source.
- Active audio sources.
- IPTV output status.
- Server resource usage.
- Recent alerts.
- Upcoming schedule information.
- Quick operational actions.

### 23.3 Design System

Implement a consistent design system covering:

- Colors.
- Typography.
- Buttons.
- Forms.
- Tables.
- Cards.
- Dialogs.
- Dropdowns.
- Navigation.
- Icons.
- Status indicators.
- Notifications.
- Timeline components.
- Audio mixer components.
- Video monitoring components.
- Loading states.
- Empty states.
- Error states.
- Confirmation dialogs.

Apply the approved design to every relevant page, including:

- Login.
- Forgot password.
- Reset password.
- Change password.
- Account settings.
- User administration.
- Permission management.

### 23.4 Accessibility and Localization

Implement:

- Responsive layouts.
- Desktop-focused broadcast operation.
- Appropriate tablet and mobile support.
- Keyboard navigation.
- Accessible form labels.
- Accessible dialogs.
- Appropriate color contrast.
- Arabic language support.
- English language support.
- RTL layout support.
- LTR layout support.
- Consistent date and time formatting.

### 23.5 Legacy Code and Page Cleanup

Audit all existing pages, routes, components, services, and dependencies.

Identify:

- Obsolete pages.
- Duplicate pages.
- Unused components.
- Unused API endpoints.
- Unused styles.
- Unused dependencies.
- Deprecated workflows.
- Dead code.
- Redundant functionality.

Before deleting anything:

1. Verify that it is genuinely unused.
2. Check all dependencies.
3. Check existing routes.
4. Check backend integrations.
5. Check database references.
6. Confirm that required functionality has been migrated.
7. Establish rollback capability.
8. Run relevant regression tests.

Remove unnecessary code only when it is safe to do so.

Never remove required functionality simply because an old page is being replaced.

The final application should contain only useful, necessary, and properly integrated functionality.

## 24. Phase Nineteen — Performance and Production Reliability

Inspect and optimize:

- React rendering.
- Frontend bundle size.
- API response times.
- Database queries.
- Database indexes.
- Media upload performance.
- Media processing performance.
- Streaming performance.
- CPU usage.
- Memory usage.
- Disk usage.
- Network usage.
- Worker concurrency.
- Long-running process stability.

Avoid:

- Memory leaks.
- Unbounded queues.
- Excessive polling.
- Unnecessary transcoding.
- Duplicate streaming processes.
- Uncontrolled background jobs.
- Unbounded log growth.
- Excessive database connections.

Use appropriate caching, pagination, resource limits, and background processing.

Benchmark actual performance before and after optimization.

Do not claim performance improvements without measurable evidence.

## 25. Phase Twenty — Final Testing and Production Readiness

After the approved redesign, repeat all relevant functional, security, streaming, and regression tests.

Verify that:

- Every visible button performs its intended action.
- Every form is connected to real backend functionality.
- Every protected action enforces backend permissions.
- Every relevant error is handled correctly.
- Every schedule is persisted correctly.
- Every supported source is processed correctly.
- Audio mixing affects the actual broadcast output.
- The broadcast continues independently of the browser.
- The IPTV output remains operational.
- Existing functionality has been preserved.
- Obsolete functionality has been safely removed.
- Secrets are not exposed.
- The approved design is consistently implemented.

Perform long-duration broadcast stability testing.

Verify backup and restore procedures in a safe environment.

Prepare deployment documentation and an operational runbook.

Do not deploy to production without explicit authorization.

## 26. Strict Definition of Done

A feature is not complete merely because:

- Code has been written.
- A frontend component exists.
- A button appears on the screen.
- An API endpoint exists.
- A build succeeds.
- A database table exists.
- A mock interface works.
- A test has been written but not executed.
- A dependency has been installed.
- A screenshot looks correct.

A feature may only be marked VERIFIED_COMPLETE when:

1. Its implementation is complete.
2. Its frontend and backend are correctly integrated.
3. Its database integration is verified where applicable.
4. Its security requirements are satisfied.
5. Its acceptance criteria are satisfied.
6. Relevant tests have been executed successfully.
7. Error handling has been verified.
8. Existing functionality has not been broken.
9. Relevant documentation has been updated.
10. Actual verification evidence has been recorded.

Never hide errors.

Never disable security controls merely to make tests pass.

Never substitute mock functionality for production functionality.

Never claim 100% completion while any required task remains blocked, incomplete, failed, or unverified.

Never claim production readiness when required production-environment or real-streaming tests remain outstanding.

## 27. Mandatory Progress Reporting

At the end of every phase, provide:

- Phase name.
- Tasks completed.
- Tasks still pending.
- Blocked tasks.
- Unverified tasks.
- Files created.
- Files modified.
- Files removed.
- Database migrations.
- Security improvements.
- Tests executed.
- Actual test results.
- Known limitations.
- Remaining risks.
- Required owner decisions.
- Recommended next steps.

Update TASKS.md and DEVELOPMENT_PLAN.md continuously.

Maintain a clear record of what has actually been implemented and verified.

Do not report artificial completion percentages.

Calculate progress only from clearly defined and verified tasks.

## 28. Final Deliverables

Provide:

- Complete working pallcom MCR application.
- Updated React frontend.
- Updated Node.js backend.
- Secure MySQL integration.
- Database migrations.
- Sanitized .env.example.
- Updated .gitignore.
- Security documentation.
- Architecture documentation.
- API documentation.
- Deployment instructions.
- Backup and recovery instructions.
- Operational runbook.
- User guide.
- Test reports.
- Known limitations.
- Complete task verification report.

All deliverables must reflect the actual implementation.

## 29. Final Execution Instructions

Begin immediately with Phase Zero: Repository Audit and Architecture Planning.

Inspect the existing project before making assumptions.

Create the development plan and task tracker.

Proceed with implementation in dependency order.

Do not stop after generating a plan. Implement and verify authorized development phases.

Use relevant available Skills throughout the project.

Keep changes incremental, maintainable, and reviewable.

Ask for essential missing information instead of inventing configuration, credentials, infrastructure, or requirements.

Never expose secrets in reports.

Preserve existing working functionality.

Respect all destructive-operation approval requirements.

Respect the mandatory design approval gate.

Security must remain the highest priority throughout the entire project.

Broadcast reliability must remain the second-highest priority.

Do not prioritize speed over correctness.

Do not claim that anything is finished unless it has actually been implemented and verified.

The final objective is a secure, stable, professional, and fully integrated television broadcast automation platform named **pallcom MCR**.

Start now.
# Confirmed production operating profile

This addendum governs the initial production release. The numbered requirements and their historical verification records remain in force. Proposed execution order lives in [the development plan](docs/DEVELOPMENT_PLAN.md). Only Phase One remediation is currently approved.

- **Platform.** pallcom MCR uses React.js, Node.js and production MySQL on Linux. Start with two simultaneous 1920 × 1080 television channels operating 24 hours daily. Authorized operators can create additional channels from management without source edits. Security has first priority and broadcast continuity has second priority.
- **Channel One.** Ingest individually authorized direct camera URLs using compatible RTSP, RTMP, HLS and SRT profiles. Support configurable order and dwell time, automatic and manual full-screen switching, health checks, skipping failed cameras, reconnection and all-camera fallback. Keep independent music, playlists, authorized internet radio, supported microphones, mixing and level controls active while switching cameras. Camera changes must preserve the final encoder and independent audio when technically recoverable. Include a logo, ticker and scheduled advertisements.
- **Channel Two.** Prepare approximately 72 hours of movie programming with full-length movies and scheduled ads. Support multi-gigabyte resumable uploads, persistent storage, duration and codec validation, timelines, recurrence, automatic next-item playback, fallback and recovery after service or host restart. Protect active and scheduled assets from deletion. New uploads during broadcast must meet receiver continuity targets. The 128 MiB and 60-second short-scene limits remain appropriate for that feature. Use a separate bounded architecture for long-form media.
- **Media durability.** Start capacity planning at 500 GB to 1 TB and qualify it with actual content, derivative, concurrency, backup and retention measurements. Store persistent media separately and keep references and metadata in MySQL. Full-length movies must stay outside database BLOBs. Inventory current PCM, frame and preview/media BLOBs and verify each migration before retiring prior storage.
- **Distribution.** Each channel has a permanent logical IPTV identity whose endpoint remains stable during switching, ads, schedule changes and recoverable input failures. External IPTV providers are the primary distribution audience. Require provider-specific grants, revocable credentials, optional IP allowlists, connection and bandwidth monitoring and independent revocation. Qualify protected HLS and MPEG-TS and add protocols according to provider agreements. Verify receiver continuity as well as endpoint identity.
- **Quality.** Use H.264 and AAC with 1920 × 1080 initial profiles, configurable frame rate and bitrate, and a proposed 4–6 Mbps video range per channel. Qualify hardware acceleration against identical quality, stability and fallback criteria before enabling it. Support additional profiles and channels through configuration and capacity admission.
- **Evidence.** Use [the broadcast acceptance plan](docs/BROADCAST_ACCEPTANCE_PLAN.md) to sign off measurable targets before endurance and release testing. Secure remote management and persistent workers must operate independently of the browser. Preserve the written Phase 17 design approval before Phase 18 and the separate deployment approval.
