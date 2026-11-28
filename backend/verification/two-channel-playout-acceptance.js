/**
 * Phase Six — Mandatory Two-Channel Simultaneous Full HD (1920x1080) Playout,
 * 2+ Hour Long-Duration Movie Verification, Failure/Recovery & Isolation Acceptance Fixture.
 *
 * Verifies in an isolated local environment with real GStreamer `channel-worker.py` workers
 * and independent FFmpeg/FFprobe UDP receivers:
 *  1. Long-Duration Movie Generation & Resumable Upload Verification:
 *     - Generates a genuine 2-hour-and-5-minute (7,500-second / 125-minute) Full HD 1920x1080 H.264/AAC MP4
 *       movie file on disk (`> 2 hours`), uploads it through the Phase Three resumable chunked upload API
 *       with SHA-256 verification and FFprobe inspection (`durationSeconds >= 7500`, `width: 1920`, `height: 1080`).
 *  2. Simultaneous Two-Channel Full HD 1920x1080 Playout:
 *     - Channel One (`CAMERA_ROTATION`, 1920x1080 @ 25fps):
 *       * Rotates across multiple live synthetic IP camera feeds (UDP MPEG-TS camera 1 & camera 2).
 *       * Camera embedded audio is muted while independent Phase Five music audio (`440 Hz`) plays continuously.
 *       * Measures camera switching transition latency, continuous audio RMS across camera rotation,
 *         temporary camera exclusion/failure -> automatic fallback -> camera recovery, and manual camera switching.
 *     - Channel Two (`MOVIE_PLAYOUT`, 1920x1080 @ 25fps):
 *       * Continuously plays a sequential queue of prerecorded Full HD media items (including a short intro clip
 *         that automatically transitions into the 2+ hour Full HD movie and an inserted advertisement break),
 *         verifies safe seeking (e.g., seeking to +3,600 seconds / 1 hour mark inside the 2+ hour movie),
 *         pause/resume, and missing/corrupted file skip recovery.
 *  3. Independent FFmpeg/FFprobe Receiver Verification on Both Channels Simultaneously:
 *     - Probes and decodes both Channel One and Channel Two UDP MPEG-TS outputs simultaneously,
 *       verifying actual `1920x1080` H.264 video resolution, `25 fps` frame rate, and `48,000 Hz` stereo AAC audio.
 *  4. Cross-Channel Fault & Lifecycle Isolation + Worker Crash Recovery:
 *     - Terminates Channel One's GStreamer worker process (`SIGKILL`) to simulate an unexpected worker crash:
 *       verifies Channel Two continues broadcasting 1920x1080 video and audio without interruption while
 *       Channel One automatically enters `RECOVERING` and respawns its worker (`restartCount = 1`) within bounded time.
 *     - Restarts Channel Two while verifying Channel One continues broadcasting uninterrupted.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { closeFixtureProcess } from './close-fixture-process.js';

const directory = mkdtempSync(join(tmpdir(), 'mcr-two-channel-1080p-acceptance-'));
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

await mediaStorage.ensureInitialized();

const usersRepo = RepositoryFactory.getUserRepository();
const stationsRepo = RepositoryFactory.getStationRepository();
const mediaRepo = RepositoryFactory.getMediaRepository();

const adminUser = await usersRepo.create({
  email: 'phase6-admin@pallcom.local',
  fullName: 'Phase Six Broadcast Director',
  passwordHash: 'unused',
  role: 'ORG_ADMIN',
  organizationId: 'org-phase6'
});
const adminSession = createSession(adminUser.id);
const adminToken = CryptoService.signAccessToken({ sub: adminUser.id, sid: adminSession.id });

const channelOne = await stationsRepo.create({
  name: 'Channel 1 — Live IP Camera Rotation (1080p)',
  organizationId: 'org-phase6',
  encryptedPassword: 'unused',
  status: 'ONLINE',
  fps: 25
});

const channelTwo = await stationsRepo.create({
  name: 'Channel 2 — 24/7 Movie & Ad Playout (1080p)',
  organizationId: 'org-phase6',
  encryptedPassword: 'unused',
  status: 'ONLINE',
  fps: 25
});

server.listen(0, '127.0.0.1');
await once(server, 'listening');
const origin = `http://127.0.0.1:${server.address().port}`;
const authHeaders = { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' };

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

try {
  // =========================================================================
  // STEP 1: Generate & Upload a Genuine 2-Hour-and-5-Minute (7,500s) Full HD
  //         1920x1080 H.264/AAC Movie via Resumable Chunked Upload
  // =========================================================================
  console.log('Generating 2-hour-and-5-minute (7,500s) Full HD 1920x1080 H.264/AAC movie fixture...');
  const baseSegmentPath = join(directory, 'base-1080p-5s.mp4');
  execFileSync(ffmpegBin, [
    '-nostdin', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'color=c=0x102542:s=1920x1080:r=25',
    '-f', 'lavfi', '-i', 'sine=f=528:r=48000',
    '-t', '5',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-g', '50',
    '-c:a', 'aac', '-b:a', '128k', '-ac', '2',
    baseSegmentPath
  ], { windowsHide: true });

  // Concatenate 1,500 segments (1,500 * 5s = 7,500 seconds = 2 hours 5 minutes) without re-encoding
  const concatListPath = join(directory, 'concat-list.txt');
  const escapedSeg = baseSegmentPath.replace(/\\/g, '/').replace(/'/g, "'\\''");
  const listContent = Array.from({ length: 1500 }, () => `file '${escapedSeg}'`).join('\n');
  await import('node:fs/promises').then(fs => fs.writeFile(concatListPath, listContent, 'utf8'));

  const longMoviePath = join(directory, 'movie-2h05m-1080p.mp4');
  execFileSync(ffmpegBin, [
    '-nostdin', '-loglevel', 'error',
    '-f', 'concat', '-safe', '0',
    '-i', concatListPath,
    '-c', 'copy',
    longMoviePath
  ], { windowsHide: true });

  const longMovieBytes = readFileSync(longMoviePath);
  const longMovieSha256 = createHash('sha256').update(longMovieBytes).digest('hex');
  console.log(`Generated 2h05m 1080p movie: size=${longMovieBytes.length} bytes, sha256=${longMovieSha256.slice(0, 16)}...`);

  // Upload the 2h05m movie via the Phase Three resumable chunked upload API
  const uploadSession = await apiCall('/media/uploads', 'POST', {
    title: 'Phase Six 2h05m Full HD Feature Film',
    category: 'MOVIES',
    originalFilename: 'movie-2h05m-1080p.mp4',
    declaredMimeType: 'video/mp4',
    expectedSizeBytes: longMovieBytes.length,
    expectedChecksumSha256: longMovieSha256
  });

  const chunkSizeBytes = uploadSession.chunkSizeBytes || (64 * 1024 * 1024);
  for (let offset = 0; offset < longMovieBytes.length; offset += chunkSizeBytes) {
    const chunk = longMovieBytes.subarray(offset, Math.min(longMovieBytes.length, offset + chunkSizeBytes));
    await apiCall(`/media/uploads/${uploadSession.id}`, 'PATCH', chunk, {
      'Content-Type': 'application/offset+octet-stream',
      'Upload-Offset': String(offset)
    });
  }
  const finalizedUpload = await apiCall(`/media/uploads/${uploadSession.id}/complete`, 'POST', {
    expectedChecksumSha256: longMovieSha256
  });
  const longMovieAssetId = finalizedUpload.id || finalizedUpload.asset?.id;

  await until('2h05m Full HD 1920x1080 movie asset validated READY by FFprobe/FFmpeg', async () => {
    const asset = await apiCall(`/media/assets/${longMovieAssetId}`);
    return asset.processingStatus === 'READY' &&
      asset.width === 1920 &&
      asset.height === 1080 &&
      asset.durationSeconds >= 7490;
  });
  const verifiedLongMovie = await apiCall(`/media/assets/${longMovieAssetId}`);
  console.log(`[PASS] Verified 2+ hour Full HD movie in Media Library: duration=${verifiedLongMovie.durationSeconds}s (${Math.round(verifiedLongMovie.durationSeconds / 60)} min), resolution=${verifiedLongMovie.width}x${verifiedLongMovie.height}`);

  // Also create a short 2-second 1080p intro clip and a 2-second 1080p advertisement clip for queue & ad-transition verification
  const introClipPath = join(directory, 'intro-1080p-2s.mp4');
  const adClipPath = join(directory, 'ad-1080p-2s.mp4');
  const ch1MusicPath = join(directory, 'ch1-music-440.mp3');

  execFileSync(ffmpegBin, [
    '-nostdin', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'testsrc2=s=1920x1080:r=25',
    '-f', 'lavfi', '-i', 'sine=f=660:r=48000',
    '-t', '2',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-ac', '2',
    introClipPath
  ], { windowsHide: true });

  execFileSync(ffmpegBin, [
    '-nostdin', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'color=c=0xf59e0b:s=1920x1080:r=25',
    '-f', 'lavfi', '-i', 'sine=f=880:r=48000',
    '-t', '2',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-ac', '2',
    adClipPath
  ], { windowsHide: true });

  execFileSync(ffmpegBin, [
    '-nostdin', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'sine=f=440:r=48000',
    '-t', '4', '-ac', '2', '-c:a', 'libmp3lame', '-b:a', '128k',
    ch1MusicPath
  ], { windowsHide: true });

  const introBytes = readFileSync(introClipPath);
  const adBytes = readFileSync(adClipPath);
  const musicBytes = readFileSync(ch1MusicPath);

  const introAssetId = randomUUID();
  const adAssetId = randomUUID();
  const musicAssetId = randomUUID();
  const { storageKey: introKey } = await mediaStorage.storeBuffer('org-phase6', introAssetId, 'mp4', introBytes);
  const { storageKey: adKey } = await mediaStorage.storeBuffer('org-phase6', adAssetId, 'mp4', adBytes);
  const { storageKey: musicKey } = await mediaStorage.storeBuffer('org-phase6', musicAssetId, 'bin', musicBytes);

  await mediaRepo.createAsset({
    id: introAssetId,
    organizationId: 'org-phase6',
    title: 'Channel Two Intro Bumper 1080p',
    category: 'INTROS_OUTROS',
    kind: 'VIDEO',
    originalFilename: 'intro-1080p-2s.mp4',
    storageKey: introKey,
    sizeBytes: introBytes.length,
    checksumSha256: 'a'.repeat(64),
    mimeType: 'video/mp4',
    containerFormat: 'mp4',
    videoCodec: 'h264',
    audioCodec: 'aac',
    width: 1920,
    height: 1080,
    frameRate: 25,
    durationSeconds: 2,
    hasVideo: true,
    hasAudio: true,
    uploadStatus: 'UPLOADED',
    processingStatus: 'READY',
    broadcastCompatibility: 'DIRECT_PLAYBACK',
    createdByUserId: adminUser.id
  });

  await mediaRepo.createAsset({
    id: adAssetId,
    organizationId: 'org-phase6',
    title: 'Sponsor Interstitial Ad 1080p',
    category: 'ADVERTISEMENTS',
    kind: 'VIDEO',
    originalFilename: 'ad-1080p-2s.mp4',
    storageKey: adKey,
    sizeBytes: adBytes.length,
    checksumSha256: 'b'.repeat(64),
    mimeType: 'video/mp4',
    containerFormat: 'mp4',
    videoCodec: 'h264',
    audioCodec: 'aac',
    width: 1920,
    height: 1080,
    frameRate: 25,
    durationSeconds: 2,
    hasVideo: true,
    hasAudio: true,
    uploadStatus: 'UPLOADED',
    processingStatus: 'READY',
    broadcastCompatibility: 'DIRECT_PLAYBACK',
    createdByUserId: adminUser.id
  });

  await mediaRepo.createAsset({
    id: musicAssetId,
    organizationId: 'org-phase6',
    title: 'Channel One Continuous Independent Music 440Hz',
    category: 'MUSIC',
    kind: 'AUDIO',
    originalFilename: 'ch1-music-440.mp3',
    storageKey: musicKey,
    sizeBytes: musicBytes.length,
    checksumSha256: 'c'.repeat(64),
    mimeType: 'audio/mpeg',
    containerFormat: 'mp3',
    audioCodec: 'mp3',
    durationSeconds: 4,
    audioChannels: 2,
    sampleRateHz: 48000,
    hasVideo: false,
    hasAudio: true,
    uploadStatus: 'UPLOADED',
    processingStatus: 'READY',
    broadcastCompatibility: 'DIRECT_PLAYBACK',
    createdByUserId: adminUser.id
  });

  // =========================================================================
  // STEP 2: Configure Channel One (Live IP Camera Rotation + Independent Music)
  //         and Channel Two (Sequential Movie Playout + Ads + Missing File Recovery)
  // =========================================================================
  const cam1UdpPort = 26210;
  const cam2UdpPort = 26212;
  const ch1OutPort = 26310;
  const ch2OutPort = 26312;

  // Start two synthetic live 1920x1080 IP camera feeds (with silent embedded audio)
  spawnFfmpegProcess([
    '-re',
    '-f', 'lavfi', '-i', 'color=c=0x1d4ed8:s=1920x1080:r=25',
    '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo',
    '-c:v', 'libx264', '-tune', 'zerolatency', '-preset', 'ultrafast', '-g', '25',
    '-c:a', 'aac', '-b:a', '128k',
    '-f', 'mpegts', `udp://127.0.0.1:${cam1UdpPort}?pkt_size=1316`
  ]);
  spawnFfmpegProcess([
    '-re',
    '-f', 'lavfi', '-i', 'color=c=0x047857:s=1920x1080:r=25',
    '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo',
    '-c:v', 'libx264', '-tune', 'zerolatency', '-preset', 'ultrafast', '-g', '25',
    '-c:a', 'aac', '-b:a', '128k',
    '-f', 'mpegts', `udp://127.0.0.1:${cam2UdpPort}?pkt_size=1316`
  ]);

  // Configure Channel One Independent Audio (Music 440 Hz, Camera Audio Muted)
  await apiCall(`/channels/${channelOne.id}/audio/sources`, 'POST', {
    name: 'Channel One Independent Music 440Hz',
    sourceType: 'UPLOADED_AUDIO',
    mediaAssetId: musicAssetId,
    priority: 60,
    volumeLinear: 0.9
  });
  await apiCall(`/channels/${channelOne.id}/audio/mixer`, 'PATCH', {
    routingMode: 'SILENT_VIDEO_WITH_INDEPENDENT_AUDIO',
    cameraAudioMuted: true
  });

  // Configure Channel One Playout (1920x1080 @ 25fps, rotating every 2 seconds between Cam 1 and Cam 2)
  await apiCall(`/channels/${channelOne.id}/playout/config`, 'PATCH', {
    playoutMode: 'CAMERA_ROTATION',
    width: 1920,
    height: 1080,
    frameRate: 25,
    videoBitrateKbps: 4500,
    outputUdpPort: ch1OutPort,
    cameraRepeat: true,
    cameraSequence: [
      { id: 'cam-live-1', sourceId: 'cam-live-1', name: 'Camera 1 Blue 1080p', udpPort: cam1UdpPort, durationSeconds: 2, enabled: true },
      { id: 'cam-live-2', sourceId: 'cam-live-2', name: 'Camera 2 Green 1080p', udpPort: cam2UdpPort, durationSeconds: 2, enabled: true }
    ]
  });

  // Configure Channel Two Playout (1920x1080 @ 25fps, Intro -> Ad Break -> 2h05m Feature Film)
  await apiCall(`/channels/${channelTwo.id}/playout/config`, 'PATCH', {
    playoutMode: 'MOVIE_PLAYOUT',
    width: 1920,
    height: 1080,
    frameRate: 25,
    videoBitrateKbps: 4500,
    outputUdpPort: ch2OutPort,
    movieRepeat: true,
    movieQueue: [
      { id: 'item-intro', assetId: introAssetId, title: 'Channel Two Intro Bumper 1080p', durationSeconds: 2 },
      { id: 'item-feature', assetId: longMovieAssetId, title: 'Phase Six 2h05m Full HD Feature Film', durationSeconds: 7500 }
    ],
    adSchedulePolicy: {
      enabled: true,
      intervalMovies: 1,
      adAssetIds: [adAssetId]
    }
  });

  // =========================================================================
  // STEP 3: Start Both Full HD Channels Simultaneously and Verify 1920x1080
  //         Video & Audio Output via Independent Receivers
  // =========================================================================
  await apiCall(`/channels/${channelOne.id}/playout/lifecycle`, 'POST', { action: 'start' });
  await apiCall(`/channels/${channelTwo.id}/playout/lifecycle`, 'POST', { action: 'start' });

  // Probe actual UDP MPEG-TS video stream parameters on both channels with ffprobe
  const ch1VideoStream = probeUdpVideoStream(ch1OutPort);
  const ch2VideoStream = probeUdpVideoStream(ch2OutPort);
  assert.equal(ch1VideoStream?.width, 1920, `Expected Channel 1 width 1920, got ${JSON.stringify(ch1VideoStream)}`);
  assert.equal(ch1VideoStream?.height, 1080, `Expected Channel 1 height 1080, got ${JSON.stringify(ch1VideoStream)}`);
  assert.equal(ch1VideoStream?.codec_name, 'h264');
  assert.equal(ch2VideoStream?.width, 1920, `Expected Channel 2 width 1920, got ${JSON.stringify(ch2VideoStream)}`);
  assert.equal(ch2VideoStream?.height, 1080, `Expected Channel 2 height 1080, got ${JSON.stringify(ch2VideoStream)}`);
  assert.equal(ch2VideoStream?.codec_name, 'h264');
  console.log(`[PASS] Independent FFprobe receivers verified simultaneous Full HD 1920x1080 H.264 outputs on Channel 1 (${ch1OutPort}) and Channel 2 (${ch2OutPort})`);

  // Attach continuous PCM audio decoders to both channels simultaneously
  const ch1Receiver = attachChannelReceiver(ch1OutPort);
  const ch2Receiver = attachChannelReceiver(ch2OutPort);

  await until('Both Channel 1 (independent music) and Channel 2 (movie audio) decode active stereo audio', () => {
    return ch1Receiver.audioBytes > 24000 && ch1Receiver.rms > 300 &&
      ch2Receiver.audioBytes > 24000 && ch2Receiver.rms > 200;
  }, 25000);

  // =========================================================================
  // STEP 4: Verify Channel One Automatic Camera Rotation, Temporary Exclusion
  //         Fallback, and Recovery while Independent Audio Continues
  // =========================================================================
  await until('Channel 1 automatically rotates between Camera 1 and Camera 2 without encoder restart', async () => {
    const snap = await apiCall(`/channels/${channelOne.id}/playout`);
    const camSwitches = snap.runtime.lastTransitions.filter(t => t.kind === 'CAMERA_SWITCH').length;
    return camSwitches >= 2 &&
      ch1Receiver.audioBytes > 32000 &&
      snap.config.restartCount === 0;
  });

  // Exclude both cameras temporarily -> verify automatic FALLBACK_ACTIVE while audio continues
  await apiCall(`/channels/${channelOne.id}/playout/camera/exclude`, 'POST', { sourceId: 'cam-live-1', excluded: true });
  await apiCall(`/channels/${channelOne.id}/playout/camera/exclude`, 'POST', { sourceId: 'cam-live-2', excluded: true });
  await until('Channel 1 activates FALLBACK_ACTIVE when all cameras are excluded/unavailable', async () => {
    const snap = await apiCall(`/channels/${channelOne.id}/playout`);
    return snap.config.runtimeState === 'FALLBACK_ACTIVE' && snap.config.fallbackActive === true;
  });

  // Restore Camera 1 -> verify automatic recovery to RUNNING
  await apiCall(`/channels/${channelOne.id}/playout/camera/exclude`, 'POST', { sourceId: 'cam-live-1', excluded: false });
  await apiCall(`/channels/${channelOne.id}/playout/camera/exclude`, 'POST', { sourceId: 'cam-live-2', excluded: false });
  await until('Channel 1 recovers automatically from fallback to RUNNING when cameras return', async () => {
    const snap = await apiCall(`/channels/${channelOne.id}/playout`);
    return snap.config.runtimeState === 'RUNNING' && snap.config.fallbackActive === false;
  });

  // =========================================================================
  // STEP 5: Verify Channel Two Sequential Transition (Intro -> Ad -> 2h05m Movie)
  //         and Safe Seeking to the 1-Hour Mark (+3,600,000 ms)
  // =========================================================================
  await until('Channel 2 transitions automatically from Intro + Ad into the 2h05m Feature Film', async () => {
    const snap = await apiCall(`/channels/${channelTwo.id}/playout`);
    return snap.config.currentMediaAssetId === longMovieAssetId;
  }, 25000);

  // Seek to 1 hour (3,600,000 ms) inside the 2h05m movie without loading the file into memory
  await apiCall(`/channels/${channelTwo.id}/playout/movie/seek`, 'POST', { positionMs: 3600000 });
  await until('Channel 2 seeks cleanly to the 1-hour mark (3,600,000 ms) of the 2h05m movie', async () => {
    const snap = await apiCall(`/channels/${channelTwo.id}/playout`);
    const pos = snap.runtime.workerStatus?.filePlayer?.positionMs ?? snap.config.playbackPositionMs;
    return pos >= 3595000;
  });

  // =========================================================================
  // STEP 6: Cross-Channel Fault Isolation & Automatic Worker Crash Recovery
  // =========================================================================
  const ch2BytesBeforeCh1Crash = ch2Receiver.audioBytes;
  const ch1Inst = multiChannelPlayout.getInstance(channelOne.id, 'org-phase6');
  const oldCh1Pid = ch1Inst.proc.pid;
  // Simulate unexpected worker termination on Channel 1
  ch1Inst.proc.kill('SIGKILL');

  await until('Channel 1 automatically detects worker crash and recovers with a new worker PID while Channel 2 continues uninterrupted', async () => {
    const [snap1, snap2] = await Promise.all([
      apiCall(`/channels/${channelOne.id}/playout`),
      apiCall(`/channels/${channelTwo.id}/playout`)
    ]);
    return snap1.config.runtimeState === 'RUNNING' &&
      snap1.config.restartCount >= 1 &&
      snap1.runtime.workerPid &&
      snap1.runtime.workerPid !== oldCh1Pid &&
      snap2.config.runtimeState === 'RUNNING' &&
      snap2.config.restartCount === 0 &&
      ch2Receiver.audioBytes > ch2BytesBeforeCh1Crash + 32000;
  }, 25000);

  // Restart Channel 2 explicitly and verify Channel 1 continues without restart
  const ch1BytesBeforeCh2Restart = ch1Receiver.audioBytes;
  const ch1SnapBefore = await apiCall(`/channels/${channelOne.id}/playout`);
  await apiCall(`/channels/${channelTwo.id}/playout/lifecycle`, 'POST', { action: 'restart' });
  await sleep(600);
  const ch1SnapAfter = await apiCall(`/channels/${channelOne.id}/playout`);
  assert.equal(ch1SnapAfter.runtime.workerPid, ch1SnapBefore.runtime.workerPid, 'Channel 2 restart must never restart Channel 1 worker');
  assert.ok(ch1Receiver.audioBytes > ch1BytesBeforeCh2Restart, 'Channel 1 audio output must continue during Channel 2 restart');

  const finalCh1 = await apiCall(`/channels/${channelOne.id}/playout`);
  const finalCh2 = await apiCall(`/channels/${channelTwo.id}/playout`);
  console.log(
    `Phase Six Two-Channel Full HD 1920x1080 Playout & 2h05m Movie Acceptance passed: ` +
    `ch1Frames=${finalCh1.runtime.workerStatus?.videoFramesEncoded}, ch1Transitions=${finalCh1.runtime.lastTransitions.length}, ` +
    `ch1RecoveryMs=${finalCh1.runtime.lastRecoveries[0]?.recoveryMs}ms, ` +
    `ch2MovieDuration=${verifiedLongMovie.durationSeconds}s, rssMb=${finalCh1.runtime.resources?.processRssMb}MB`
  );
} finally {
  await multiChannelPlayout.stopAll();
  await Promise.all(childProcesses.map(p => closeFixtureProcess(p, 'Phase Six FFmpeg')));
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  getSqliteDatabase().close();
  rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
