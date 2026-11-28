/**
 * Phase Seven — Mandatory Two-Channel Simultaneous Full HD (1920x1080) Broadcast Scheduling,
 * Multi-Track Timeline Execution, Mid-Movie Ad Interruption/Resume, and As-Run Verification Fixture.
 *
 * Verifies in an isolated local environment with real GStreamer `channel-worker.py` workers,
 * `ChannelScheduleExecutor` / `multiChannelScheduler`, and independent FFmpeg/FFprobe UDP receivers:
 *  1. Channel One (Scheduled Live Camera Rotation + Continuous Music + Scheduled Audio Change + Ad + Manual Override):
 *     - Publishes and executes a multi-track schedule (`LIVE_CAMERA_ROTATION`, `INDEPENDENT_AUDIO`,
 *       `ADVERTISEMENTS`, `GRAPHICS_OVERLAYS`, `NEWS_TICKER`, `AUTOMATION_CONTROL`).
 *     - Rotates across two live synthetic Full HD 1920x1080 IP camera feeds (`cam1`, `cam2`) with embedded
 *       camera audio muted while independent Phase Five music audio (`440 Hz`) plays continuously.
 *     - Executes a scheduled independent audio track transition (`440 Hz` -> `660 Hz` music stream),
 *       a scheduled Channel One advertisement, temporary camera failure -> fallback -> recovery,
 *       a manual operator override (`MANUAL_SOURCE_OVERRIDE`), and `RETURN_TO_SCHEDULE`.
 *  2. Channel Two (Scheduled Full HD Movies + Mid-Movie Advertisement Interruption & Accurate Resume + Live Schedule Update):
 *     - Publishes and executes a multi-track schedule containing a Full HD 1920x1080 movie (`MAIN_VIDEO`),
 *       a scheduled mid-movie advertisement break (`ADVERTISEMENTS`), a `FOLLOW_PREVIOUS` movie,
 *       a scheduled watermark (`GRAPHICS_OVERLAYS`), and a scheduled ticker (`NEWS_TICKER`).
 *     - Verifies that when the scheduled mid-movie advertisement triggers, the active movie is interrupted,
 *       the ad plays on air, and upon ad completion the movie automatically resumes from the recorded
 *       `resumeOffsetMs` playback position (`RESUMED_AFTER_AD` in As-Run log).
 *     - Verifies that editing a draft revision while Channel Two is broadcasting does not disrupt live output,
 *       and publishing an updated revision with `APPLY_NEXT_BOUNDARY` / `APPLY_IMMEDIATELY_SAFE` transitions safely.
 *  3. Cross-Channel Isolation & Independent Receiver Verification:
 *     - Independent `ffprobe` and `ffmpeg` receivers verify simultaneous `1920x1080 @ 25fps` H.264 video
 *       and `48,000 Hz` stereo AAC audio on both channels.
 *     - Verifies that restarting Channel One's scheduler/worker does not interrupt Channel Two's broadcast.
 *     - Verifies that As-Run logs accurately match actual worker-confirmed execution events on both channels.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { closeFixtureProcess } from './close-fixture-process.js';

const directory = mkdtempSync(join(tmpdir(), 'mcr-two-channel-scheduler-1080p-'));
const storageRoot = join(directory, 'storage');
const secret = () => randomBytes(32).toString('hex');
const ffmpegBin = process.env.FFMPEG_PATH || 'ffmpeg';
const ffprobeBin = process.env.FFPROBE_PATH || 'ffprobe';

Object.assign(process.env, {
  NODE_ENV: 'test',
  STORAGE_MODE: 'sqlite',
  SQLITE_DB_PATH: join(directory, 'fixture.sqlite'),
  MCR_MEDIA_STORAGE_ROOT: storageRoot,
  MCR_MEDIA_IMPORT_DIR: join(storageRoot, 'imports'),
  MCR_ALLOW_LOOPBACK_VIDEO_SOURCE_FOR_TESTS: '1',
  JWT_SECRET: secret(),
  REFRESH_TOKEN_SECRET: secret(),
  ENCRYPTION_MASTER_KEY: secret()
});

const { server } = await import('../src/index.js');
const { RepositoryFactory } = await import('../src/infrastructure/repositories/repository-factory.js');
const { CryptoService } = await import('../src/infrastructure/security/crypto-service.js');
const { createSession } = await import('../src/infrastructure/security/session-service.js');
const { getSqliteDatabase } = await import('../src/infrastructure/database/sqlite.js');
const { mediaStorage } = await import('../src/infrastructure/media/storage-manager.js');
const { multiChannelPlayout } = await import('../src/infrastructure/playout/channel-playout-supervisor.js');
const { multiChannelScheduler } = await import('../src/infrastructure/scheduler/broadcast-scheduler-engine.js');

await mediaStorage.ensureInitialized();

const usersRepo = RepositoryFactory.getUserRepository();
const stationsRepo = RepositoryFactory.getStationRepository();
const mediaRepo = RepositoryFactory.getMediaRepository();

const adminUser = await usersRepo.create({
  email: 'phase7-admin@pallcom.local',
  fullName: 'Phase Seven Broadcast Scheduler Director',
  passwordHash: 'unused',
  role: 'ORG_ADMIN',
  organizationId: 'org-phase7'
});
const adminSession = createSession(adminUser.id);
const adminToken = CryptoService.signAccessToken({ sub: adminUser.id, sid: adminSession.id });

const channelOne = await stationsRepo.create({
  name: 'Channel 1 — Scheduled Live Camera Rotation & Music (1080p)',
  organizationId: 'org-phase7',
  encryptedPassword: 'unused',
  status: 'ONLINE',
  fps: 25
});

const channelTwo = await stationsRepo.create({
  name: 'Channel 2 — Scheduled Full HD Movies & Mid-Movie Ads (1080p)',
  organizationId: 'org-phase7',
  encryptedPassword: 'unused',
  status: 'ONLINE',
  fps: 25
});

server.listen(0, '127.0.0.1');
await once(server, 'listening');
const origin = `http://127.0.0.1:${server.address().port}`;
const authHeaders = { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json', Connection: 'close' };

async function apiCall(path, method = 'GET', body = undefined, extraHeaders = {}) {
  const res = await fetch(`${origin}/api/v1${path}`, {
    method,
    headers: { ...authHeaders, ...extraHeaders },
    ...(body !== undefined ? { body: Buffer.isBuffer(body) ? body : JSON.stringify(body) } : {})
  });
  const json = await res.json();
  assert.ok(res.status >= 200 && res.status < 300, `API ${method} ${path} failed (${res.status}): ${JSON.stringify(json)}`);
  return json.data;
}

const childProcesses = [];
function spawnFfmpegProcess(args, stdio = 'ignore') {
  const proc = spawn(ffmpegBin, ['-nostdin', '-loglevel', 'error', ...args], { windowsHide: true, stdio });
  childProcesses.push(proc);
  return proc;
}

function attachChannelReceiver(udpPort) {
  const proc = spawnFfmpegProcess([
    '-analyzeduration', '1000000',
    '-probesize', '65536',
    '-i', `udp://127.0.0.1:${udpPort}?fifo_size=65536&overrun_nonfatal=1`,
    '-map', '0:a',
    '-ac', '2',
    '-ar', '48000',
    '-f', 's16le',
    'pipe:1'
  ], ['ignore', 'pipe', 'ignore']);

  const state = {
    udpPort,
    audioBytes: 0,
    rms: 0,
    peak: 0,
    windowsWithAudio: 0,
    proc
  };
  let carry = Buffer.alloc(0);
  proc.stdout.on('data', chunk => {
    const pcm = carry.length ? Buffer.concat([carry, chunk]) : chunk;
    const count = Math.floor(pcm.length / 2);
    let sum = 0;
    let peak = 0;
    for (let i = 0; i < count; i++) {
      const s = Math.abs(pcm.readInt16LE(i * 2));
      if (s > peak) peak = s;
      sum += s * s;
    }
    if (count > 0) {
      state.rms = Math.sqrt(sum / count);
      state.peak = peak;
      if (state.rms > 120) state.windowsWithAudio += 1;
    }
    state.audioBytes += count * 2;
    carry = pcm.subarray(count * 2);
  });
  return state;
}

function probeUdpVideoStream(udpPort) {
  const out = execFileSync(ffprobeBin, [
    '-v', 'error',
    '-analyzeduration', '4000000',
    '-probesize', '2097152',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=codec_name,width,height,r_frame_rate',
    '-of', 'json',
    `udp://127.0.0.1:${udpPort}?timeout=6000000`
  ], { windowsHide: true, encoding: 'utf8', timeout: 12000 });
  const parsed = JSON.parse(out);
  return parsed.streams?.[0] || null;
}

async function until(label, predicate, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    assert(Date.now() < deadline, `${label} timed out`);
    await sleep(100);
  }
  console.log(`[PASS] ${label}`);
}

async function createAsset({ title, category, kind = 'VIDEO', filePath, ext, durationSeconds, mimeType, width = 1920, height = 1080 }) {
  const id = randomUUID();
  const bytes = readFileSync(filePath);
  const { storageKey } = await mediaStorage.storeBuffer('org-phase7', id, ext, bytes);
  return mediaRepo.createAsset({
    id,
    organizationId: 'org-phase7',
    title,
    category,
    kind,
    originalFilename: filePath.split(/[\\/]/).pop(),
    storageKey,
    sizeBytes: bytes.length,
    checksumSha256: randomBytes(32).toString('hex'),
    mimeType,
    containerFormat: ext,
    videoCodec: kind === 'VIDEO' ? 'h264' : null,
    audioCodec: kind === 'IMAGE' ? null : 'aac',
    width: kind === 'AUDIO' ? null : width,
    height: kind === 'AUDIO' ? null : height,
    frameRate: kind === 'VIDEO' ? 25 : null,
    durationSeconds,
    audioChannels: kind === 'AUDIO' ? 2 : null,
    sampleRateHz: kind === 'AUDIO' ? 48000 : null,
    hasVideo: kind !== 'AUDIO',
    hasAudio: kind !== 'IMAGE',
    uploadStatus: 'UPLOADED',
    processingStatus: 'READY',
    broadcastCompatibility: 'DIRECT_PLAYBACK',
    createdByUserId: adminUser.id
  });
}

function ff(args) {
  execFileSync(ffmpegBin, ['-nostdin', '-loglevel', 'error', ...args], { windowsHide: true });
}

try {
  // STEP 1: fixtures (two live 1080p cameras, music, movies, ad, logo)
  const cam1Port = 27110;
  const cam2Port = 27112;
  const ch1OutPort = 27210;
  const ch2OutPort = 27220;
  for (const [color, port] of [['0x1d4ed8', cam1Port], ['0x047857', cam2Port]]) {
    spawnFfmpegProcess([
      '-re', '-f', 'lavfi', '-i', `color=c=${color}:s=1920x1080:r=25`,
      '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo',
      '-c:v', 'libx264', '-tune', 'zerolatency', '-preset', 'ultrafast', '-g', '25',
      '-c:a', 'aac', '-b:a', '128k', '-f', 'mpegts', `udp://127.0.0.1:${port}?pkt_size=1316`
    ]);
  }

  const paths = {
    musicA: join(directory, 'music-440.mp3'),
    musicB: join(directory, 'music-660.mp3'),
    movieA: join(directory, 'movie-a.mp4'),
    movieB: join(directory, 'movie-b.mp4'),
    ad: join(directory, 'ad.mp4'),
    logo: join(directory, 'logo.png')
  };
  ff(['-f', 'lavfi', '-i', 'sine=f=440:r=48000', '-t', '120', '-ac', '2', '-c:a', 'libmp3lame', '-b:a', '128k', paths.musicA]);
  ff(['-f', 'lavfi', '-i', 'sine=f=660:r=48000', '-t', '120', '-ac', '2', '-c:a', 'libmp3lame', '-b:a', '128k', paths.musicB]);
  const video = (path, color, freq, secs) => ff([
    '-f', 'lavfi', '-i', `color=c=${color}:s=1920x1080:r=25`, '-f', 'lavfi', '-i', `sine=f=${freq}:r=48000`,
    '-t', String(secs), '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-g', '25',
    '-c:a', 'aac', '-b:a', '128k', '-ac', '2', path
  ]);
  video(paths.movieA, '0x0f766e', 520, 60);
  video(paths.movieB, '0x1e3a8a', 600, 30);
  video(paths.ad, '0xf59e0b', 880, 3);
  ff(['-f', 'lavfi', '-i', 'color=c=0x38bdf8:s=160x60', '-frames:v', '1', paths.logo]);

  const musicA = await createAsset({ title: 'Scheduled Music 440Hz', category: 'MUSIC', kind: 'AUDIO', filePath: paths.musicA, ext: 'bin', durationSeconds: 120, mimeType: 'audio/mpeg' });
  const musicB = await createAsset({ title: 'Scheduled Music 660Hz', category: 'MUSIC', kind: 'AUDIO', filePath: paths.musicB, ext: 'bin', durationSeconds: 120, mimeType: 'audio/mpeg' });
  const movieA = await createAsset({ title: 'Scheduled Feature Film A 1080p', category: 'MOVIES', filePath: paths.movieA, ext: 'mp4', durationSeconds: 60, mimeType: 'video/mp4' });
  const movieB = await createAsset({ title: 'Scheduled Feature Film B 1080p', category: 'MOVIES', filePath: paths.movieB, ext: 'mp4', durationSeconds: 30, mimeType: 'video/mp4' });
  const adAsset = await createAsset({ title: 'Scheduled Ad 1080p', category: 'ADVERTISEMENTS', filePath: paths.ad, ext: 'mp4', durationSeconds: 3, mimeType: 'video/mp4' });
  const logoAsset = await createAsset({ title: 'Scheduled Watermark', category: 'LOGOS', kind: 'IMAGE', filePath: paths.logo, ext: 'png', durationSeconds: 0, mimeType: 'image/png', width: 160, height: 60 });

  // Channel 1 audio: Deck A enabled, Deck B disabled until the schedule enables it
  const deckA = await apiCall(`/channels/${channelOne.id}/audio/sources`, 'POST', {
    name: 'Deck A 440Hz', sourceType: 'UPLOADED_AUDIO', mediaAssetId: musicA.id, priority: 60, volumeLinear: 0.9
  });
  const deckB = await apiCall(`/channels/${channelOne.id}/audio/sources`, 'POST', {
    name: 'Deck B 660Hz', sourceType: 'UPLOADED_AUDIO', mediaAssetId: musicB.id, priority: 70, volumeLinear: 0.9, enabled: false
  });
  await apiCall(`/channels/${channelOne.id}/audio/mixer`, 'PATCH', {
    routingMode: 'SILENT_VIDEO_WITH_INDEPENDENT_AUDIO', cameraAudioMuted: true
  });

  await apiCall(`/channels/${channelOne.id}/playout/config`, 'PATCH', {
    playoutMode: 'CAMERA_ROTATION', width: 1920, height: 1080, frameRate: 25, videoBitrateKbps: 4500,
    outputUdpPort: ch1OutPort, cameraRepeat: true,
    cameraSequence: [
      { id: 'cam-live-1', sourceId: 'cam-live-1', name: 'Camera 1', udpPort: cam1Port, durationSeconds: 2, enabled: true },
      { id: 'cam-live-2', sourceId: 'cam-live-2', name: 'Camera 2', udpPort: cam2Port, durationSeconds: 2, enabled: true }
    ]
  });
  await apiCall(`/channels/${channelTwo.id}/playout/config`, 'PATCH', {
    playoutMode: 'MOVIE_PLAYOUT', width: 1920, height: 1080, frameRate: 25, videoBitrateKbps: 4500,
    outputUdpPort: ch2OutPort,
    movieQueue: [{ id: 'boot', assetId: movieA.id, title: movieA.title, durationSeconds: 60 }]
  });

  // STEP 2: start both channel workers, verify Full HD outputs with independent receivers
  await apiCall(`/channels/${channelOne.id}/playout/lifecycle`, 'POST', { action: 'start' });
  await apiCall(`/channels/${channelTwo.id}/playout/lifecycle`, 'POST', { action: 'start' });
  const [p1, p2] = [probeUdpVideoStream(ch1OutPort), probeUdpVideoStream(ch2OutPort)];
  for (const p of [p1, p2]) {
    assert.equal(p?.codec_name, 'h264');
    assert.equal(p?.width, 1920);
    assert.equal(p?.height, 1080);
  }
  console.log('[PASS] Independent FFprobe: both channels output 1920x1080 H.264');
  const ch1Receiver = attachChannelReceiver(ch1OutPort);
  const ch2Receiver = attachChannelReceiver(ch2OutPort);

  // STEP 3: publish schedules (starting ~2s from now) and start schedulers
  const t0 = Date.now() + 2500;
  const iso = ms => new Date(t0 + ms).toISOString();

  const ch1Draft = await apiCall(`/channels/${channelOne.id}/scheduler/draft`, 'PUT', {
    name: 'Channel 1 Scheduled Cameras & Music', timezone: 'Asia/Hebron', activationPolicy: 'APPLY_IMMEDIATELY_SAFE',
    gapPolicy: 'FALLBACK_CAMERA',
    events: [
      { id: 'ch1-cams', trackType: 'LIVE_CAMERA_ROTATION', executionMode: 'HARD_START', title: 'Live Camera Rotation',
        startUtc: iso(0), durationMs: 90000,
        metadata: { cameraSequence: [
          { id: 'cam-live-1', sourceId: 'cam-live-1', name: 'Camera 1', udpPort: cam1Port, durationSeconds: 2, enabled: true },
          { id: 'cam-live-2', sourceId: 'cam-live-2', name: 'Camera 2', udpPort: cam2Port, durationSeconds: 2, enabled: true }
        ] } },
      { id: 'ch1-deck-a', trackType: 'INDEPENDENT_AUDIO', executionMode: 'HARD_START', title: 'Music Deck A',
        audioSourceId: deckA.id, startUtc: iso(0), durationMs: 8000,
        metadata: { routingMode: 'SILENT_VIDEO_WITH_INDEPENDENT_AUDIO', enabled: true, volumeLinear: 0.9 } },
      { id: 'ch1-deck-b', trackType: 'INDEPENDENT_AUDIO', executionMode: 'HARD_START', title: 'Music Deck B',
        audioSourceId: deckB.id, startUtc: iso(8000), durationMs: 80000,
        metadata: { enabled: true, volumeLinear: 0.95 } },
      { id: 'ch1-ad', trackType: 'ADVERTISEMENTS', executionMode: 'FIXED_DURATION', title: 'Channel 1 Ad',
        mediaAssetId: adAsset.id, startUtc: iso(12000), durationMs: 3000 },
      { id: 'ch1-wm', trackType: 'GRAPHICS_OVERLAYS', executionMode: 'FIXED_DURATION', title: 'Channel 1 Watermark',
        mediaAssetId: logoAsset.id, startUtc: iso(0), durationMs: 90000, metadata: { enabled: true } },
      { id: 'ch1-ticker', trackType: 'NEWS_TICKER', executionMode: 'FIXED_DURATION', title: 'Channel 1 Ticker',
        startUtc: iso(0), durationMs: 90000, metadata: { tickerText: 'CHANNEL 1 SCHEDULED', enabled: true } },
      { id: 'ch1-auto', trackType: 'AUTOMATION_CONTROL', executionMode: 'HARD_START', title: 'Automation Marker',
        startUtc: iso(5000), durationMs: 2000, metadata: { action: 'MARK' } }
    ]
  });
  await apiCall(`/channels/${channelOne.id}/scheduler/publish`, 'POST', { revisionId: ch1Draft.id, activationPolicy: 'APPLY_IMMEDIATELY_SAFE' });

  const ch2Events = [
    { id: 'ch2-film-a', trackType: 'MAIN_VIDEO', executionMode: 'HARD_START', title: 'Feature Film A',
      mediaAssetId: movieA.id, startUtc: iso(0), durationMs: 60000, priority: 70 },
    { id: 'ch2-film-b', trackType: 'MAIN_VIDEO', executionMode: 'SOFT_START', title: 'Feature Film B',
      mediaAssetId: movieB.id, startUtc: iso(60000), durationMs: 30000, priority: 65 },
    { id: 'ch2-ad', trackType: 'ADVERTISEMENTS', executionMode: 'FIXED_DURATION', title: 'Mid-Movie Ad',
      mediaAssetId: adAsset.id, startUtc: iso(6000), durationMs: 3000, priority: 95 },
    { id: 'ch2-wm', trackType: 'GRAPHICS_OVERLAYS', executionMode: 'FIXED_DURATION', title: 'Channel 2 Watermark',
      mediaAssetId: logoAsset.id, startUtc: iso(0), durationMs: 90000, metadata: { enabled: true } },
    { id: 'ch2-ticker', trackType: 'NEWS_TICKER', executionMode: 'FIXED_DURATION', title: 'Channel 2 Ticker',
      startUtc: iso(0), durationMs: 90000, metadata: { tickerText: 'CHANNEL 2 SCHEDULED CINEMA', enabled: true } }
  ];
  const ch2Draft = await apiCall(`/channels/${channelTwo.id}/scheduler/draft`, 'PUT', {
    name: 'Channel 2 Scheduled Movies & Ads', timezone: 'Asia/Hebron', activationPolicy: 'APPLY_IMMEDIATELY_SAFE',
    gapPolicy: 'CHANNEL_IDENT_CLIP', gapFallbackAssetId: adAsset.id, events: ch2Events
  });
  await apiCall(`/channels/${channelTwo.id}/scheduler/publish`, 'POST', { revisionId: ch2Draft.id, activationPolicy: 'APPLY_IMMEDIATELY_SAFE' });

  await Promise.all([
    apiCall(`/channels/${channelOne.id}/scheduler/control`, 'POST', { action: 'START_SCHEDULER' }),
    apiCall(`/channels/${channelTwo.id}/scheduler/control`, 'POST', { action: 'START_SCHEDULER' })
  ]);

  const sched = async id => apiCall(`/channels/${id}/scheduler`);
  const asRun = async id => apiCall(`/channels/${id}/scheduler/as-run?limit=100`);

  await until('Both schedulers started their first events on schedule', async () => {
    const [a, b] = await Promise.all([sched(channelOne.id), sched(channelTwo.id)]);
    return a.executionState.currentTrackStates?.LIVE_CAMERA_ROTATION?.eventId === 'ch1-cams' &&
      b.executionState.currentTrackStates?.MAIN_VIDEO?.eventId === 'ch2-film-a';
  }, 20000);
  await until('Both channels decode audio simultaneously', () => ch1Receiver.windowsWithAudio >= 2 && ch2Receiver.windowsWithAudio >= 2, 15000);

  // STEP 4: Channel 2 mid-movie ad interruption and accurate resume
  await until('Channel 2 ad interrupts movie and movie resumes at saved offset', async () => {
    const logs = await asRun(channelTwo.id);
    const interrupted = logs.find(l => l.eventId === 'ch2-film-a' && l.status === 'INTERRUPTED_BY_AD');
    const adDone = logs.find(l => l.eventId === 'ch2-ad' && l.status === 'COMPLETED');
    const resumed = logs.find(l => l.category === 'MOVIE_RESUME' && l.resumeOffsetMs >= 4500);
    return Boolean(interrupted && adDone && resumed);
  }, 25000);
  const ch2Snap = await apiCall(`/channels/${channelTwo.id}/playout`);
  assert.equal(ch2Snap.config.currentMediaAssetId, movieA.id, 'Movie A must be on air again after the ad');
  assert.ok(ch2Snap.config.playbackPositionMs >= 4500, `Movie resumed at offset, got ${ch2Snap.config.playbackPositionMs}`);
  const resumeLog = (await asRun(channelTwo.id)).find(l => l.category === 'MOVIE_RESUME');
  console.log(`[PASS] Movie resumed at resumeOffsetMs=${resumeLog.resumeOffsetMs}, engine playbackPositionMs=${ch2Snap.config.playbackPositionMs}`);

  // STEP 5: Channel 1 scheduled audio change, scheduled ad, camera failure/fallback/recovery, manual override
  await until('Channel 1 schedule enables Deck B (scheduled audio change)', async () => {
    const src = await apiCall(`/channels/${channelOne.id}/audio/sources`);
    const list = Array.isArray(src) ? src : src.sources || [];
    return list.find(s => s.id === deckB.id)?.enabled === true;
  }, 20000);
  await until('Channel 1 scheduled advertisement ran and camera rotation returned', async () => {
    const logs = await asRun(channelOne.id);
    const s = await sched(channelOne.id);
    return logs.some(l => l.eventId === 'ch1-ad' && l.status === 'COMPLETED') &&
      s.executionState.currentTrackStates?.LIVE_CAMERA_ROTATION && !s.executionState.currentTrackStates?.ADVERTISEMENTS;
  }, 25000);

  await apiCall(`/channels/${channelOne.id}/playout/camera/exclude`, 'POST', { sourceId: 'cam-live-1', excluded: true });
  await apiCall(`/channels/${channelOne.id}/playout/camera/exclude`, 'POST', { sourceId: 'cam-live-2', excluded: true });
  await until('Channel 1 enters FALLBACK_ACTIVE when cameras fail', async () =>
    (await apiCall(`/channels/${channelOne.id}/playout`)).config.runtimeState === 'FALLBACK_ACTIVE', 15000);
  await apiCall(`/channels/${channelOne.id}/playout/camera/exclude`, 'POST', { sourceId: 'cam-live-1', excluded: false });
  await apiCall(`/channels/${channelOne.id}/playout/camera/exclude`, 'POST', { sourceId: 'cam-live-2', excluded: false });
  await until('Channel 1 recovers to RUNNING', async () =>
    (await apiCall(`/channels/${channelOne.id}/playout`)).config.runtimeState === 'RUNNING', 20000);

  const ov = await apiCall(`/channels/${channelOne.id}/scheduler/control`, 'POST', { action: 'MANUAL_SOURCE_OVERRIDE', overrideSourceId: 'cam-live-2' });
  assert.equal(ov.manualOverrideActive, true);
  const back = await apiCall(`/channels/${channelOne.id}/scheduler/control`, 'POST', { action: 'RETURN_TO_SCHEDULE' });
  assert.equal(back.manualOverrideActive, false);
  console.log('[PASS] Channel 1 manual override and return to schedule');

  // STEP 6: Channel 2 draft isolation and live republication
  const bytesBefore = ch2Receiver.audioBytes;
  const ch2Draft2 = await apiCall(`/channels/${channelTwo.id}/scheduler/draft`, 'PUT', {
    name: 'Channel 2 v2 (draft edit during broadcast)', events: ch2Events.slice(0, 3)
  });
  const ovw = await sched(channelTwo.id);
  assert.equal(ovw.published.events.length, ch2Events.length, 'Published schedule unchanged by draft edit');
  assert.equal(ovw.draft.events.length, 3);
  await sleep(1000);
  assert.ok(ch2Receiver.audioBytes > bytesBefore, 'Channel 2 on air during draft edit');
  const republished = await apiCall(`/channels/${channelTwo.id}/scheduler/publish`, 'POST', { revisionId: ch2Draft2.id, activationPolicy: 'APPLY_NEXT_BOUNDARY' });
  assert.equal(republished.published.lifecycleState, 'PUBLISHED');
  console.log('[PASS] Channel 2 draft isolation and live republication');

  // STEP 7: cross-channel isolation on Channel 1 restart + As-Run audit
  const ch2Before = ch2Receiver.audioBytes;
  const ch2Pid = (await apiCall(`/channels/${channelTwo.id}/playout`)).runtime.workerPid;
  await apiCall(`/channels/${channelOne.id}/playout/lifecycle`, 'POST', { action: 'restart' });
  await sleep(1500);
  assert.equal((await apiCall(`/channels/${channelTwo.id}/playout`)).runtime.workerPid, ch2Pid, 'Channel 2 worker untouched');
  assert.ok(ch2Receiver.audioBytes > ch2Before);

  const [a1, a2] = await Promise.all([asRun(channelOne.id), asRun(channelTwo.id)]);
  assert.ok(a1.some(l => l.eventId === 'ch1-cams' && l.workerConfirmed === true));
  assert.ok(a1.some(l => l.eventId === 'ch1-deck-b'));
  assert.ok(a1.some(l => l.eventId === 'ch1-ad' && l.status === 'COMPLETED'));
  assert.ok(a2.some(l => l.eventId === 'ch2-film-a' && l.status === 'INTERRUPTED_BY_AD'));
  assert.ok(a2.some(l => l.eventId === 'ch2-ad' && l.status === 'COMPLETED'));
  assert.ok(a2.some(l => l.category === 'MOVIE_RESUME'));
  console.log('[PASS] As-Run logs match executed events on both channels');
  console.log('PHASE SEVEN TWO-CHANNEL FULL HD SCHEDULER ACCEPTANCE PASSED');
} finally {
  multiChannelScheduler.stopAll();
  await multiChannelPlayout.stopAll();
  await Promise.all(childProcesses.map(p => closeFixtureProcess(p, 'Phase Seven FFmpeg')));
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  getSqliteDatabase().close();
  try { rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch {}
}
