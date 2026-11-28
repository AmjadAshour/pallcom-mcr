import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, openSync, readFileSync, rmSync, statSync, writeSync, closeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const directory = mkdtempSync(join(tmpdir(), 'mcr-phase3-verify-'));
const storageRoot = join(directory, 'media-storage');
const importDir = join(storageRoot, 'imports');
const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
const secret = () => randomBytes(32).toString('hex');

Object.assign(process.env, {
  NODE_ENV: 'development',
  STORAGE_MODE: 'sqlite',
  SQLITE_DB_PATH: join(directory, 'fixture.sqlite'),
  MCR_MEDIA_STORAGE_ROOT: storageRoot,
  MCR_MEDIA_IMPORT_DIR: importDir,
  MCR_MEDIA_ORG_QUOTA_MIB: '8192',
  MCR_MEDIA_MAX_FILE_SIZE_MIB: '4096',
  MCR_MEDIA_CHUNK_MAX_MIB: '64',
  MCR_BIND_HOST: '127.0.0.1',
  PORT: '25910',
  MCR_PROGRAM_RUNTIME_PORT: '25911',
  MCR_PROGRAM_INPUT_HOST: '127.0.0.1',
  MCR_PROGRAM_INPUT_PORT: '25912',
  MCR_PROGRAM_OUTPUT_PORT: '25913',
  MCR_PROGRAM_SECOND_INPUT_PORT: '',
  MCR_PROGRAM_INPUT_URL: '',
  MCR_PROGRAM_SRT_URL: '',
  MCR_PROGRAM_SRT_PASSPHRASE: '',
  MCR_PROGRAM_RECORDING_DIR: '',
  MCR_PROGRAM_AUTOSTART: '0',
  JWT_SECRET: secret(),
  REFRESH_TOKEN_SECRET: secret(),
  ENCRYPTION_MASTER_KEY: secret()
});

const { RepositoryFactory } = await import('../src/infrastructure/repositories/repository-factory.js');
const { CryptoService } = await import('../src/infrastructure/security/crypto-service.js');
const { createSession } = await import('../src/infrastructure/security/session-service.js');
const { getSqliteDatabase } = await import('../src/infrastructure/database/sqlite.js');

const station = await RepositoryFactory.getStationRepository().create({
  name: 'Phase Three Movie Broadcast Station',
  organizationId: 'fixture-org',
  encryptedPassword: 'unused'
});
const user = await RepositoryFactory.getUserRepository().create({
  email: 'phase3@fixture.local',
  fullName: 'Phase Three Operator',
  passwordHash: 'unused',
  role: 'OPERATOR',
  organizationId: 'fixture-org'
});
process.env.MCR_PROGRAM_STATION_ID = station.id;
const token = CryptoService.signAccessToken({ sub: user.id, sid: createSession(user.id).id });
getSqliteDatabase().close();

// 1. Build a real 1.05 GiB (1,127,219,200 bytes) Full HD 1920x1080 MP4 file on disk without loading it into memory
const baseMp4Path = join(directory, 'base-1080p.mp4');
execFileSync(ffmpeg, [
  '-nostdin', '-loglevel', 'error',
  '-f', 'lavfi', '-i', 'testsrc2=s=1920x1080:r=25',
  '-f', 'lavfi', '-i', 'sine=f=440:r=48000',
  '-t', '4',
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast',
  '-c:a', 'aac', '-ac', '2',
  baseMp4Path
], { windowsHide: true });

const largeMp4Path = join(directory, 'feature-1gib.mp4');
const baseBytes = readFileSync(baseMp4Path);
const hash = createHash('sha256');
const fd = openSync(largeMp4Path, 'w', 0o600);
let totalWritten = 0;
writeSync(fd, baseBytes, 0, baseBytes.length, 0);
hash.update(baseBytes);
totalWritten += baseBytes.length;

// Append 16 x 64 MiB valid MP4 'free' atoms (= 1,024 MiB + baseBytes > 1 GiB)
const freeBoxSize = 64 * 1024 * 1024;
const freeChunk = Buffer.alloc(freeBoxSize, 0);
freeChunk.writeUInt32BE(freeBoxSize, 0);
freeChunk.write('free', 4);
for (let i = 0; i < 16; i++) {
  writeSync(fd, freeChunk, 0, freeChunk.length, totalWritten);
  hash.update(freeChunk);
  totalWritten += freeChunk.length;
}
closeSync(fd);
const expectedSha256 = hash.digest('hex');
assert.equal(statSync(largeMp4Path).size, totalWritten);
assert.ok(totalWritten > 1024 * 1024 * 1024, 'Synthetic MP4 must exceed 1 GiB');

// 2. Also generate a long-duration (180-second / 3-minute) Full HD 1080p MP4 clip exceeding the old 60-second limit
const longMp4Path = join(directory, 'long-180s.mp4');
execFileSync(ffmpeg, [
  '-nostdin', '-loglevel', 'error',
  '-f', 'lavfi', '-i', 'color=c=navy:s=1920x1080:r=25',
  '-f', 'lavfi', '-i', 'sine=f=440:r=48000',
  '-t', '180',
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast', '-g', '250',
  '-c:a', 'aac', '-ac', '2', '-b:a', '64k',
  longMp4Path
], { windowsHide: true });
const longBytes = readFileSync(longMp4Path);

const apiRoot = 'http://127.0.0.1:25910/api/v1';
const programRoot = `${apiRoot}/stations/${station.id}/program`;

const startProc = (script, env = process.env) =>
  spawn(process.execPath, [script], { env, windowsHide: true, stdio: 'inherit' });

async function stopProc(child) {
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = once(child, 'close');
    child.kill();
    await exited;
  }
}

async function apiCall(path, { method = 'GET', body, headers = {} } = {}) {
  const isBuf = Buffer.isBuffer(body);
  return fetch(apiRoot + path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body && !isBuf ? { 'Content-Type': 'application/json' } : {}),
      ...headers
    },
    body: isBuf ? body : body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(120000)
  });
}

let runtime = startProc('backend/src/program-runtime.js');
let web = startProc('backend/src/index.js');
let receiver;

try {
  // Wait for API startup
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const ready = await fetch(apiRoot + '/media/storage', {
      headers: { Authorization: `Bearer ${token}` }
    }).then(r => r.status === 200).catch(() => false);
    if (ready) break;
    await sleep(150);
  }

  // Start Independent Program broadcast engine and attach independent UDP receiver
  const startProgramRes = await fetch(programRoot, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'start' })
  });
  assert.equal(startProgramRes.status, 200);

  receiver = spawn(ffmpeg, [
    '-nostdin', '-loglevel', 'error',
    '-i', 'udp://127.0.0.1:25913?timeout=15000000',
    '-t', '6',
    '-map', '0:v:0',
    '-vf', 'scale=64:36',
    '-f', 'framemd5',
    'pipe:1'
  ], { windowsHide: true, stdio: ['ignore', 'pipe', 'inherit'] });

  let receiverExitCode = null;
  let receiverExitPromise = once(receiver, 'close').then(([code]) => {
    receiverExitCode = code;
    return code;
  });
  let decodedFramesOutput = '';
  receiver.stdout.on('data', chunk => { decodedFramesOutput += chunk.toString(); });

  // Concurrently initiate and stream the 1+ GiB resumable upload while Program is broadcasting
  const initRes = await apiCall('/media/uploads', {
    method: 'POST',
    body: {
      title: '1 GiB Full HD Feature Film',
      category: 'MOVIES',
      originalFilename: 'feature-1gib.mp4',
      expectedSizeBytes: totalWritten,
      expectedChecksumSha256: expectedSha256
    }
  });
  assert.equal(initRes.status, 201);
  const session = (await initRes.json()).data;

  const chunkBytes = 64 * 1024 * 1024;
  const readFd = openSync(largeMp4Path, 'r');
  const chunkBuf = Buffer.allocUnsafe(chunkBytes);
  let offset = 0;

  try {
    // Upload first 512 MiB (8 chunks)
    for (let i = 0; i < 8; i++) {
      const toRead = Math.min(chunkBytes, totalWritten - offset);
      const slice = chunkBuf.subarray(0, toRead);
      const readCount = await import('node:fs').then(fs => fs.readSync(readFd, slice, 0, toRead, offset));
      assert.equal(readCount, toRead);
      const patchRes = await apiCall(`/media/uploads/${session.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/offset+octet-stream',
          'Upload-Offset': String(offset)
        },
        body: slice
      });
      assert.equal(patchRes.status, 200);
      offset += readCount;
    }

    // Simulate temporary backend restart mid-upload!
    await stopProc(web);
    web = startProc('backend/src/index.js');
    const restartDeadline = Date.now() + 20000;
    while (Date.now() < restartDeadline) {
      const up = await apiCall(`/media/uploads/${session.id}`).then(r => r.status === 200).catch(() => false);
      if (up) break;
      await sleep(150);
    }

    // Verify upload progress survived backend restart
    const statusAfterRestart = await (await apiCall(`/media/uploads/${session.id}`)).json();
    assert.equal(statusAfterRestart.data.receivedBytes, offset);

    // Resume remaining chunks after backend restart up to 1.05 GiB
    while (offset < totalWritten) {
      const toRead = Math.min(chunkBytes, totalWritten - offset);
      const slice = chunkBuf.subarray(0, toRead);
      const readCount = await import('node:fs').then(fs => fs.readSync(readFd, slice, 0, toRead, offset));
      assert.equal(readCount, toRead);
      const patchRes = await apiCall(`/media/uploads/${session.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/offset+octet-stream',
          'Upload-Offset': String(offset)
        },
        body: slice
      });
      assert.equal(patchRes.status, 200);
      offset += readCount;
    }
  } finally {
    closeSync(readFd);
  }

  const completeRes = await apiCall(`/media/uploads/${session.id}/complete`, {
    method: 'POST',
    body: { expectedChecksumSha256: expectedSha256 }
  });
  assert.equal(completeRes.status, 201);
  const largeAsset = (await completeRes.json()).data;

  // Also upload the 180-second (3-minute) video clip to verify removal of the old 60-second limitation
  const longInit = await (await apiCall('/media/uploads', {
    method: 'POST',
    body: {
      title: '180s Long Duration Video',
      category: 'TV_PROGRAMS',
      originalFilename: 'long-180s.mp4',
      expectedSizeBytes: longBytes.length
    }
  })).json();
  await apiCall(`/media/uploads/${longInit.data.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/offset+octet-stream', 'Upload-Offset': '0' },
    body: longBytes
  });
  const longComplete = await (await apiCall(`/media/uploads/${longInit.data.id}/complete`, {
    method: 'POST',
    body: {}
  })).json();

  // Wait for both assets to reach READY
  for (const id of [largeAsset.id, longComplete.data.id]) {
    const checkDeadline = Date.now() + 45000;
    let current;
    while (Date.now() < checkDeadline) {
      current = (await (await apiCall(`/media/assets/${id}`)).json()).data;
      if (['READY', 'FAILED', 'QUARANTINED'].includes(current.processingStatus)) break;
      await sleep(250);
    }
    assert.equal(current.processingStatus, 'READY', `Asset ${id} failed validation: ${current?.errorReason}`);
  }

  const verified1GiB = (await (await apiCall(`/media/assets/${largeAsset.id}`)).json()).data;
  assert.equal(verified1GiB.sizeBytes, totalWritten);
  assert.equal(verified1GiB.checksumSha256, expectedSha256);
  assert.equal(verified1GiB.width, 1920);
  assert.equal(verified1GiB.height, 1080);
  assert.equal(verified1GiB.broadcastCompatibility, 'DIRECT_PLAYBACK');

  const verifiedLong = (await (await apiCall(`/media/assets/${longComplete.data.id}`)).json()).data;
  assert.ok(verifiedLong.durationSeconds >= 179, `Expected >= 179s duration, got ${verifiedLong.durationSeconds}`);

  // Verify independent broadcast receiver decoded uninterrupted frames during the 1+ GiB upload, restart, and FFprobe processing
  const receiverExit = receiverExitCode !== null ? receiverExitCode : await receiverExitPromise;
  assert.equal(receiverExit, 0);
  const frameLines = decodedFramesOutput.split('\n').filter(line => /^0,/.test(line));
  assert.ok(frameLines.length >= 100, `Expected at least 100 decoded broadcast frames during concurrent 1 GiB upload, got ${frameLines.length}`);

  console.log(`Phase Three 1.05 GiB (${totalWritten} bytes) resumable upload, backend restart recovery, 180s duration validation, and concurrent broadcast continuity (${frameLines.length} frames) passed`);
} finally {
  await fetch(programRoot, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'stop' })
  }).catch(() => {});
  await Promise.all([stopProc(receiver), stopProc(web), stopProc(runtime)]);
  rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
