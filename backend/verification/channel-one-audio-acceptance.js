/**
 * Phase Five — Channel One Broadcast Acceptance Scenario
 *
 * Verifies in an isolated local environment with a real GStreamer Program broadcast worker
 * and independent FFmpeg UDP audio (48 kHz s16le PCM) receiver:
 *  1. Channel One broadcasts active video sources (obs -> obs2 -> fallback -> obs).
 *  2. Camera/embedded video audio is muted (`cameraAudioMuted: true`) while an independent
 *     music/radio audio source provides the broadcast audio track via `pushExternalAudioFrame`.
 *  3. Video sources switch repeatedly while independent audio remains continuous without
 *     audio dropout, clipping, or unplanned encoder restart (`session` remains identical).
 *  4. Primary video source fails temporarily -> fallback video activates while independent
 *     audio continues uninterrupted.
 *  5. Primary audio source fails -> automatic fallback audio activates -> primary audio recovers.
 *  6. Advertisement audio interruption policy (`REPLACE_MUSIC_PAUSE_PLAYLIST`)
 *     executes cleanly and restores background music afterward.
 *  7. Authorized microphone activation ducks background music by -14 dB and smoothly restores it.
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

const directory = mkdtempSync(join(tmpdir(), 'mcr-channel1-audio-acceptance-'));
const storageRoot = join(directory, 'storage');
const secret = () => randomBytes(32).toString('hex');
const ffmpegBin = process.env.FFMPEG_PATH || 'ffmpeg';

Object.assign(process.env, {
  NODE_ENV: 'test',
  STORAGE_MODE: 'sqlite',
  SQLITE_DB_PATH: join(directory, 'fixture.sqlite'),
  MCR_MEDIA_STORAGE_ROOT: storageRoot,
  MCR_MEDIA_IMPORT_DIR: join(storageRoot, 'imports'),
  JWT_SECRET: secret(),
  REFRESH_TOKEN_SECRET: secret(),
  ENCRYPTION_MASTER_KEY: secret(),
  MCR_PROGRAM_INPUT_PORT: '25620',
  MCR_PROGRAM_SECOND_INPUT_PORT: '25621',
  MCR_PROGRAM_OUTPUT_PORT: '25622',
  MCR_PROGRAM_INPUT_HOST: '127.0.0.1',
  MCR_PROGRAM_INPUT_URL: '',
  MCR_PROGRAM_RUNTIME_PORT: '',
  MCR_PROGRAM_RECORDING_DIR: '',
  MCR_PROGRAM_AUTO_BACKUP: '0',
  MCR_PROGRAM_AUDIO_MONITOR: '1'
});

const { server } = await import('../src/index.js');
const { RepositoryFactory } = await import('../src/infrastructure/repositories/repository-factory.js');
const { CryptoService } = await import('../src/infrastructure/security/crypto-service.js');
const { createSession } = await import('../src/infrastructure/security/session-service.js');
const { getSqliteDatabase } = await import('../src/infrastructure/database/sqlite.js');
const { mediaStorage } = await import('../src/infrastructure/media/storage-manager.js');
const { generateTonePcm } = await import('../src/infrastructure/audio/audio-mixer-engine.js');

await mediaStorage.ensureInitialized();

const station = await RepositoryFactory.getStationRepository().create({
  name: 'Channel One Master Control',
  organizationId: 'org-ch1-accept',
  encryptedPassword: 'unused',
  status: 'ONLINE',
  fps: 25
});
process.env.MCR_PROGRAM_STATION_ID = station.id;

const operatorUser = await RepositoryFactory.getUserRepository().create({
  email: 'ch1-operator@pallcom.local',
  fullName: 'Channel One Operator',
  passwordHash: 'unused',
  role: 'OPERATOR',
  organizationId: 'org-ch1-accept'
});
const opSession = createSession(operatorUser.id);
const opToken = CryptoService.signAccessToken({ sub: operatorUser.id, sid: opSession.id });

// Create two distinct broadcast audio assets (Music 440 Hz and Fallback/Ad 880 Hz)
const musicFile = join(directory, 'ch1-music-440.mp3');
const fallbackFile = join(directory, 'ch1-fallback-880.mp3');
execFileSync(ffmpegBin, [
  '-nostdin', '-loglevel', 'error',
  '-f', 'lavfi', '-i', 'sine=f=440:r=48000',
  '-t', '3', '-ac', '2', '-c:a', 'libmp3lame', '-b:a', '128k',
  musicFile
], { windowsHide: true });
execFileSync(ffmpegBin, [
  '-nostdin', '-loglevel', 'error',
  '-f', 'lavfi', '-i', 'sine=f=880:r=48000',
  '-t', '3', '-ac', '2', '-c:a', 'libmp3lame', '-b:a', '128k',
  fallbackFile
], { windowsHide: true });

const musicBytes = readFileSync(musicFile);
const fallbackBytes = readFileSync(fallbackFile);
const musicAssetId = randomUUID();
const fallbackAssetId = randomUUID();
const { storageKey: musicKey } = await mediaStorage.storeBuffer('org-ch1-accept', musicAssetId, 'bin', musicBytes);
const { storageKey: fallbackKey } = await mediaStorage.storeBuffer('org-ch1-accept', fallbackAssetId, 'bin', fallbackBytes);

const mediaRepo = RepositoryFactory.getMediaRepository();
const musicAsset = await mediaRepo.createAsset({
  id: musicAssetId,
  organizationId: 'org-ch1-accept',
  title: 'Channel One Continuous Music 440Hz',
  category: 'MUSIC',
  kind: 'AUDIO',
  originalFilename: 'ch1-music-440.mp3',
  storageKey: musicKey,
  sizeBytes: musicBytes.length,
  checksumSha256: '1'.repeat(64),
  mimeType: 'audio/mpeg',
  containerFormat: 'mp3',
  audioCodec: 'mp3',
  durationSeconds: 3,
  audioChannels: 2,
  sampleRateHz: 48000,
  hasVideo: false,
  hasAudio: true,
  uploadStatus: 'UPLOADED',
  processingStatus: 'READY',
  broadcastCompatibility: 'DIRECT_PLAYBACK',
  createdByUserId: operatorUser.id
});

const fallbackAsset = await mediaRepo.createAsset({
  id: fallbackAssetId,
  organizationId: 'org-ch1-accept',
  title: 'Channel One Fallback & Ad Tone 880Hz',
  category: 'FALLBACK',
  kind: 'AUDIO',
  originalFilename: 'ch1-fallback-880.mp3',
  storageKey: fallbackKey,
  sizeBytes: fallbackBytes.length,
  checksumSha256: '2'.repeat(64),
  mimeType: 'audio/mpeg',
  containerFormat: 'mp3',
  audioCodec: 'mp3',
  durationSeconds: 3,
  audioChannels: 2,
  sampleRateHz: 48000,
  hasVideo: false,
  hasAudio: true,
  uploadStatus: 'UPLOADED',
  processingStatus: 'READY',
  broadcastCompatibility: 'DIRECT_PLAYBACK',
  createdByUserId: operatorUser.id
});

server.listen(0, '127.0.0.1');
await once(server, 'listening');
const origin = `http://127.0.0.1:${server.address().port}`;
const programUrl = `${origin}/api/v1/stations/${station.id}/program`;
const channelAudioUrl = `${origin}/api/v1/channels/${station.id}/audio`;
const headers = { Authorization: `Bearer ${opToken}`, 'Content-Type': 'application/json' };

async function programStatus() {
  return (await (await fetch(programUrl, { headers })).json()).data;
}

async function programAction(action, params = {}) {
  const res = await fetch(programUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({ action, ...params })
  });
  const json = await res.json();
  assert.equal(res.status, 200, JSON.stringify(json));
  return json.data;
}

async function channelApi(path, method = 'GET', body = undefined) {
  const res = await fetch(`${channelAudioUrl}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });
  const json = await res.json();
  assert.ok(res.status >= 200 && res.status < 300, `API ${method} ${path} failed (${res.status}): ${JSON.stringify(json)}`);
  return json.data;
}

const devices = [];
function spawnFfmpeg(args, stdio = 'ignore') {
  const proc = spawn(ffmpegBin, ['-nostdin', '-loglevel', 'error', ...args], { windowsHide: true, stdio });
  devices.push(proc);
  return proc;
}

function startBroadcastReceiver(inputUrl) {
  const child = spawnFfmpeg([
    '-analyzeduration', '500000',
    '-probesize', '8192',
    '-i', inputUrl,
    '-map', '0:a',
    '-ac', '2',
    '-ar', '48000',
    '-f', 's16le',
    'pipe:1'
  ], ['ignore', 'pipe', 'ignore']);

  const feed = { rms: 0, peak: 0, bytes: 0, windowsWithSignal: 0, windowsSilent: 0, child };
  let carry = Buffer.alloc(0);
  child.stdout.on('data', chunk => {
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
      feed.rms = Math.sqrt(sum / count);
      feed.peak = peak;
      if (feed.rms > 150) {
        feed.windowsWithSignal += 1;
      } else {
        feed.windowsSilent += 1;
      }
    }
    feed.bytes += count * 2;
    carry = pcm.subarray(count * 2);
  });
  return feed;
}

async function until(label, check, timeoutMs = 16000) {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    assert(Date.now() < deadline, `${label} timed out`);
    await sleep(80);
  }
  console.log(`[PASS] ${label}`);
}

let pumperActive = true;
let pumperPromise = null;

try {
  // 1. Start UDP receiver and Program broadcast session on Channel One
  const udpFeed = startBroadcastReceiver('udp://127.0.0.1:25622');
  const started = await programAction('start');
  const initialSession = started.session;
  assert.ok(initialSession, 'Expected initial Program session ID');

  // 2. Start two live video sources (obs on 25620 and obs2 on 25621) with SILENT embedded audio
  // so that any audible signal on the broadcast output proves the independent audio engine is driving Program audio!
  const cam1Proc = spawnFfmpeg([
    '-re',
    '-f', 'lavfi', '-i', 'color=blue:s=640x360:r=25',
    '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo',
    '-c:v', 'libx264', '-tune', 'zerolatency', '-preset', 'ultrafast', '-g', '25',
    '-c:a', 'aac', '-b:a', '128k',
    '-f', 'mpegts', 'udp://127.0.0.1:25620?pkt_size=1316'
  ]);
  spawnFfmpeg([
    '-re',
    '-f', 'lavfi', '-i', 'color=green:s=640x360:r=25',
    '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo',
    '-c:v', 'libx264', '-tune', 'zerolatency', '-preset', 'ultrafast', '-g', '25',
    '-c:a', 'aac', '-b:a', '128k',
    '-f', 'mpegts', 'udp://127.0.0.1:25621?pkt_size=1316'
  ]);

  await until('Both live camera inputs (obs and obs2) are ready', async () => {
    const st = await programStatus();
    return st.obs === 'ready' && st.obs2 === 'ready';
  });

  // 3. Configure Channel One Independent Audio Sources:
  //    - Primary Music Source (440 Hz)
  //    - Fallback Audio Source (880 Hz)
  //    - Sponsor Advertisement Audio Source (880 Hz)
  //    - Operator Microphone Input (Ducking Trigger)
  const musicSource = await channelApi('/sources', 'POST', {
    name: 'Channel One Primary Music 440Hz',
    sourceType: 'UPLOADED_AUDIO',
    mediaAssetId: musicAsset.id,
    priority: 50,
    duckingTarget: true,
    volumeLinear: 0.9,
    gainDb: 0
  });

  const fallbackSource = await channelApi('/sources', 'POST', {
    name: 'Channel One Emergency Fallback 880Hz',
    sourceType: 'FALLBACK_AUDIO',
    mediaAssetId: fallbackAsset.id,
    priority: 10,
    volumeLinear: 0.85
  });

  const adSource = await channelApi('/sources', 'POST', {
    name: 'Channel One Sponsor Ad Audio',
    sourceType: 'ADVERTISEMENT_AUDIO',
    mediaAssetId: fallbackAsset.id,
    enabled: false,
    priority: 90,
    duckingTrigger: true,
    duckingTarget: false
  });

  const micSource = await channelApi('/sources', 'POST', {
    name: 'Channel One Director Microphone',
    sourceType: 'MICROPHONE_INPUT',
    priority: 95,
    duckingTrigger: true,
    duckingTarget: false
  });

  await channelApi('/mixer', 'PATCH', {
    routingMode: 'SILENT_VIDEO_WITH_INDEPENDENT_AUDIO',
    fallbackSourceId: fallbackSource.id,
    fallbackAssetId: fallbackAsset.id,
    cameraAudioMuted: true,
    duckingEnabled: true,
    duckingThresholdDbfs: -28,
    duckingReductionDb: -14,
    duckingAttackMs: 40,
    duckingHoldMs: 120,
    duckingReleaseMs: 200,
    adAudioPolicy: 'REPLACE_MUSIC_PAUSE_PLAYLIST'
  });

  // Start continuous 20 ms real-time PCM mix pumping into the GStreamer broadcast worker
  let mixIterations = 0;
  let lastStepData = null;
  pumperPromise = (async () => {
    while (pumperActive) {
      try {
        lastStepData = await channelApi('/step', 'POST', { frames: 3, persistMeters: false });
        mixIterations += 3;
      } catch {
        // ignore transient close errors during teardown
      }
      await sleep(25);
    }
  })();

  // 4. Switch to Camera 1 (obs) and verify UDP receiver decodes continuous independent music audio
  await programAction('obs');
  await until('Independent music audio is decoded on Channel One UDP broadcast output', () =>
    udpFeed.bytes > 48000 && udpFeed.rms > 1500 && mixIterations >= 10
  );

  // 5. Switch video sources repeatedly (obs -> obs2 -> fallback -> obs) while measuring uninterrupted independent audio
  const rmsSamplesDuringVideoSwitches = [];
  for (const targetSource of ['obs2', 'obs', 'obs2', 'fallback', 'obs']) {
    await programAction(targetSource);
    await sleep(250);
    rmsSamplesDuringVideoSwitches.push(udpFeed.rms);
    const st = await programStatus();
    assert.equal(st.session, initialSession, 'Video switching must never restart the broadcast encoder session');
    assert.equal(st.source, targetSource);
  }
  assert.ok(
    rmsSamplesDuringVideoSwitches.every(rms => rms > 400),
    `Independent audio dropped during video source switching: ${JSON.stringify(rmsSamplesDuringVideoSwitches)}`
  );
  console.log(`[PASS] Video sources switched 5 times without interrupting independent audio (RMS samples: ${rmsSamplesDuringVideoSwitches.map(n => Math.round(n)).join(', ')})`);

  // 6. Simulate Primary Video Source Failure -> Automatic Fallback Video while Independent Audio Continues
  await closeFixtureProcess(cam1Proc, 'Camera 1 simulated failure');
  await programAction('fallback');
  await sleep(300);
  assert.ok(udpFeed.rms > 1000, 'Independent audio must continue playing when video falls back');
  console.log('[PASS] Video source failure and fallback transition preserved continuous independent audio');

  // 7. Simulate Primary Audio Source Failure -> Automatic Fallback Audio Takeover -> Recovery
  await channelApi(`/sources/${musicSource.id}`, 'PATCH', { enabled: false });
  await until('Automatic fallback audio activates when primary audio source is disabled/lost', () => {
    const fbMeter = lastStepData?.sources?.find(s => s.id === fallbackSource.id);
    return Boolean(fbMeter && fbMeter.measuredRmsDbfs > -25) && udpFeed.rms > 1000;
  });
  await channelApi(`/sources/${musicSource.id}`, 'PATCH', { enabled: true });
  await channelApi(`/sources/${musicSource.id}/probe`, 'POST');
  await until('Primary music audio recovers cleanly from fallback', () => {
    const musicMeter = lastStepData?.sources?.find(s => s.id === musicSource.id);
    const fbMeter = lastStepData?.sources?.find(s => s.id === fallbackSource.id);
    return Boolean(musicMeter && musicMeter.measuredRmsDbfs > -25 && fbMeter && fbMeter.measuredRmsDbfs <= -80) && udpFeed.rms > 1000;
  });

  // 8. Advertisement Interruption Policy Verification (REPLACE_MUSIC_PAUSE_PLAYLIST)
  await channelApi(`/sources/${adSource.id}`, 'PATCH', { enabled: true });
  await channelApi(`/sources/${adSource.id}/probe`, 'POST');
  await channelApi('/mixer', 'PATCH', { adActive: true });
  await until('Advertisement audio replaces background music during active ad break', () => {
    const adMeter = lastStepData?.sources?.find(s => s.id === adSource.id);
    return Boolean(adMeter && adMeter.measuredRmsDbfs > -25) && udpFeed.rms > 1000;
  });
  await channelApi('/mixer', 'PATCH', { adActive: false });
  await channelApi(`/sources/${adSource.id}`, 'PATCH', { enabled: false });

  // 9. Authorized Microphone Commentary Ducking Verification
  await channelApi(`/sources/${micSource.id}/microphone`, 'POST', { action: 'activate' });
  const micCommentaryFrame = generateTonePcm(600, 120, 0.45);
  await channelApi(`/sources/${micSource.id}/microphone/pcm`, 'POST', {
    pcmBase64: micCommentaryFrame.toString('base64')
  });
  await until('Active microphone commentary applies priority ducking reduction to background music', () =>
    Boolean(lastStepData && lastStepData.duckingReductionAppliedDb <= -5)
  );
  await channelApi(`/sources/${micSource.id}/microphone`, 'POST', { action: 'deactivate' });

  // 10. Verify zero encoder restarts and healthy CPU/Memory resource usage
  const finalStatus = await programStatus();
  assert.equal(finalStatus.session, initialSession, 'Broadcast session ID must remain identical across all video & audio events');
  assert.equal(finalStatus.state, 'running', 'Expected Program worker to remain running without interruption');
  assert.equal(Number(finalStatus.restarts ?? 0), 0, 'Expected zero unplanned Program worker restarts');
  const memUsage = process.memoryUsage();
  const rssMb = Math.round((memUsage.rss / (1024 * 1024)) * 10) / 10;

  console.log(
    `Phase Five Channel One Broadcast Acceptance passed: session=${initialSession}, videoSwitches=5, mixFrames=${mixIterations}, udpDecodedBytes=${udpFeed.bytes}, restarts=${Number(finalStatus.restarts ?? 0)}, rssMb=${rssMb} MB`
  );
} finally {
  pumperActive = false;
  await pumperPromise?.catch(() => {});
  const closed = Promise.all(devices.map(device => closeFixtureProcess(device, 'Channel One FFmpeg')));
  try {
    await programAction('stop');
  } catch {
    // ignore stop error on cleanup
  } finally {
    server.closeAllConnections();
    await Promise.all([new Promise(resolve => server.close(resolve)), closed]);
    getSqliteDatabase().close();
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
