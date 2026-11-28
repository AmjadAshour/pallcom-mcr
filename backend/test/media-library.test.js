import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import sharp from 'sharp';

test('Phase Three media library, resumable uploads, validation, imports, quotas, and lifecycle checks', { timeout: 90000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'mcr-media-lib-'));
  const storageRoot = join(directory, 'storage');
  const importDir = join(storageRoot, 'imports');
  const secret = () => randomBytes(32).toString('hex');
  const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';

  Object.assign(process.env, {
    NODE_ENV: 'test',
    STORAGE_MODE: 'sqlite',
    SQLITE_DB_PATH: join(directory, 'fixture.sqlite'),
    MCR_MEDIA_STORAGE_ROOT: storageRoot,
    MCR_MEDIA_IMPORT_DIR: importDir,
    MCR_MEDIA_ORG_QUOTA_MIB: '32',
    MCR_MEDIA_MAX_FILE_SIZE_MIB: '24',
    MCR_MEDIA_CHUNK_MAX_MIB: '8',
    MCR_MEDIA_MIN_FREE_DISK_MIB: '16',
    MCR_MEDIA_LOW_DISK_ALERT_MIB: '64',
    MCR_ALLOW_LOOPBACK_MEDIA_IMPORT_FOR_TESTS: '1',
    JWT_SECRET: secret(),
    REFRESH_TOKEN_SECRET: secret(),
    ENCRYPTION_MASTER_KEY: secret()
  });

  const { server } = await import('../src/index.js');
  const { getSqliteDatabase } = await import('../src/infrastructure/database/sqlite.js');
  const { RepositoryFactory } = await import('../src/infrastructure/repositories/repository-factory.js');
  const { CryptoService } = await import('../src/infrastructure/security/crypto-service.js');
  const { createSession } = await import('../src/infrastructure/security/session-service.js');
  const { mediaStorage } = await import('../src/infrastructure/media/storage-manager.js');

  await mediaStorage.ensureInitialized();
  const db = getSqliteDatabase();
  const users = RepositoryFactory.getUserRepository();
  const stations = RepositoryFactory.getStationRepository();

  const operator = await users.create({
    id: 'op-1',
    email: 'operator@media.test',
    fullName: 'Media Operator',
    role: 'OPERATOR',
    organizationId: 'org-media',
    passwordHash: 'unused'
  });
  const viewer = await users.create({
    id: 'vw-1',
    email: 'viewer@media.test',
    fullName: 'Media Viewer',
    role: 'VIEWER',
    organizationId: 'org-media',
    passwordHash: 'unused'
  });
  const foreignOperator = await users.create({
    id: 'for-1',
    email: 'foreign@media.test',
    fullName: 'Foreign Operator',
    role: 'OPERATOR',
    organizationId: 'org-foreign',
    passwordHash: 'unused'
  });
  const station = await stations.create({
    name: 'Movie Channel 2',
    organizationId: 'org-media',
    encryptedPassword: 'unused'
  });

  const opToken = CryptoService.signAccessToken({ sub: operator.id, sid: createSession(operator.id).id });
  const viewerToken = CryptoService.signAccessToken({ sub: viewer.id, sid: createSession(viewer.id).id });
  const foreignToken = CryptoService.signAccessToken({ sub: foreignOperator.id, sid: createSession(foreignOperator.id).id });

  // Synthetic fixture files generated with FFmpeg and Sharp
  const sampleMp4Path = join(directory, 'sample-movie.mp4');
  const sampleMkvPath = join(directory, 'sample-clip.mkv');
  const sampleMp3Path = join(directory, 'sample-track.mp3');
  const sampleWavPath = join(directory, 'sample-voice.wav');
  const samplePngPath = join(directory, 'sample-logo.png');

  execFileSync(ffmpeg, [
    '-nostdin', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'testsrc2=s=1920x1080:r=25',
    '-f', 'lavfi', '-i', 'sine=f=440:r=48000',
    '-t', '2.5',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast',
    '-c:a', 'aac', '-ac', '2',
    sampleMp4Path
  ], { windowsHide: true });

  execFileSync(ffmpeg, [
    '-nostdin', '-loglevel', 'error',
    '-i', sampleMp4Path,
    '-c', 'copy',
    sampleMkvPath
  ], { windowsHide: true });

  execFileSync(ffmpeg, [
    '-nostdin', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'sine=f=528:r=48000',
    '-t', '2',
    '-c:a', 'libmp3lame',
    sampleMp3Path
  ], { windowsHide: true });

  execFileSync(ffmpeg, [
    '-nostdin', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'sine=f=660:r=48000',
    '-t', '1.5',
    '-c:a', 'pcm_s16le',
    sampleWavPath
  ], { windowsHide: true });

  const pngBytes = await sharp({
    create: { width: 320, height: 180, channels: 4, background: { r: 10, g: 140, b: 220, alpha: 1 } }
  }).png().toBuffer();
  await writeFile(samplePngPath, pngBytes);

  const mp4Bytes = await readFile(sampleMp4Path);
  const mp4Sha256 = createHash('sha256').update(mp4Bytes).digest('hex');
  const mkvBytes = await readFile(sampleMkvPath);
  const mp3Bytes = await readFile(sampleMp3Path);
  const wavBytes = await readFile(sampleWavPath);

  // Copy MKV into authorized import directory
  await writeFile(join(importDir, 'server-clip.mkv'), mkvBytes);
  await writeFile(join(directory, 'outside-secret.txt'), 'secret-data');

  // Local HTTP server for testing direct URL import & SSRF redirect rejection
  const remoteServer = createServer((req, res) => {
    if (req.url === '/audio.wav') {
      res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': String(wavBytes.length) });
      res.end(wavBytes);
      return;
    }
    if (req.url === '/redirect') {
      res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data/' });
      res.end();
      return;
    }
    res.writeHead(404).end();
  });
  remoteServer.listen(0, '127.0.0.1');
  await once(remoteServer, 'listening');
  const remoteOrigin = `http://127.0.0.1:${remoteServer.address().port}`;

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const root = `http://127.0.0.1:${server.address().port}/api/v1`;

  t.after(async () => {
    delete process.env.MCR_TEST_SIMULATED_FREE_DISK_BYTES;
    delete process.env.MCR_ALLOW_LOOPBACK_MEDIA_IMPORT_FOR_TESTS;
    remoteServer.closeAllConnections();
    await new Promise(r => remoteServer.close(r));
    server.closeAllConnections();
    await new Promise(r => server.close(r));
    db.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  async function apiCall(path, { method = 'GET', token = opToken, body, headers = {} } = {}) {
    const isBuffer = Buffer.isBuffer(body);
    const response = await fetch(root + path, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body && !isBuffer ? { 'Content-Type': 'application/json' } : {}),
        ...headers
      },
      body: isBuffer ? body : body ? JSON.stringify(body) : undefined
    });
    return response;
  }

  async function waitForAssetStatus(assetId, expectedStatuses, token = opToken) {
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline) {
      const res = await apiCall(`/media/assets/${assetId}`, { token });
      assert.equal(res.status, 200);
      const { data } = await res.json();
      if (expectedStatuses.includes(data.processingStatus)) return data;
      await sleep(150);
    }
    throw new Error(`Timed out waiting for asset ${assetId} status in ${expectedStatuses.join(',')}`);
  }

  // 1. Authorization & RBAC checks
  assert.equal((await apiCall('/media/assets', { token: null })).status, 401);
  assert.equal((await apiCall('/media/assets', { token: viewerToken })).status, 200);
  assert.equal((await apiCall('/media/uploads', {
    method: 'POST',
    token: viewerToken,
    body: { title: 'Denied', category: 'MOVIES', originalFilename: 'a.mp4', expectedSizeBytes: 100 }
  })).status, 403);

  // 2. Resumable chunked video upload (1920x1080 Full HD MP4) with interruption, duplicate chunk protection, and resume
  const splitPoint = Math.floor(mp4Bytes.length / 2);
  const chunk1 = mp4Bytes.subarray(0, splitPoint);
  const chunk2 = mp4Bytes.subarray(splitPoint);

  const initRes = await apiCall('/media/uploads', {
    method: 'POST',
    body: {
      title: 'Feature Film 1080p><script>alert(1)</script>',
      description: 'Full HD test movie',
      folder: 'movies/2026',
      category: 'MOVIES',
      tags: ['drama', 'fullhd'],
      channelIds: [station.id],
      originalFilename: '../../evil/path/Feature_Film.mp4',
      declaredMimeType: 'video/mp4',
      expectedSizeBytes: mp4Bytes.length,
      expectedChecksumSha256: mp4Sha256
    }
  });
  assert.equal(initRes.status, 201);
  const { data: uploadSession } = await initRes.json();
  assert.equal(uploadSession.originalFilename, 'Feature_Film.mp4');
  assert.equal(uploadSession.receivedBytes, 0);

  // Cross-organization upload hijacking must return 404
  assert.equal((await apiCall(`/media/uploads/${uploadSession.id}`, { token: foreignToken })).status, 404);
  assert.equal((await apiCall(`/media/uploads/${uploadSession.id}`, {
    method: 'PATCH',
    token: foreignToken,
    headers: { 'Content-Type': 'application/offset+octet-stream', 'Upload-Offset': '0' },
    body: chunk1
  })).status, 404);

  // Send chunk 1
  const patch1 = await apiCall(`/media/uploads/${uploadSession.id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/offset+octet-stream',
      'Upload-Offset': '0',
      'Upload-Checksum-Sha256': createHash('sha256').update(chunk1).digest('hex')
    },
    body: chunk1
  });
  assert.equal(patch1.status, 200);
  assert.equal(patch1.headers.get('Upload-Offset'), String(chunk1.length));

  // Duplicate chunk protection: resending offset 0 must return 409 with current server offset
  const duplicatePatch = await apiCall(`/media/uploads/${uploadSession.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/offset+octet-stream', 'Upload-Offset': '0' },
    body: chunk1
  });
  assert.equal(duplicatePatch.status, 409);
  assert.equal(duplicatePatch.headers.get('Upload-Offset'), String(chunk1.length));

  // Premature finalization before chunk 2 must return 409
  assert.equal((await apiCall(`/media/uploads/${uploadSession.id}/complete`, {
    method: 'POST',
    body: {}
  })).status, 409);

  // Query session status (simulating browser refresh / connection recovery)
  const statusCheck = await apiCall(`/media/uploads/${uploadSession.id}`);
  assert.equal(statusCheck.status, 200);
  assert.equal((await statusCheck.json()).data.receivedBytes, chunk1.length);

  // Resume from recovered offset with chunk 2
  const patch2 = await apiCall(`/media/uploads/${uploadSession.id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/offset+octet-stream',
      'Upload-Offset': String(chunk1.length)
    },
    body: chunk2
  });
  assert.equal(patch2.status, 200);
  assert.equal(patch2.headers.get('Upload-Offset'), String(mp4Bytes.length));

  // Complete upload
  const completeRes = await apiCall(`/media/uploads/${uploadSession.id}/complete`, {
    method: 'POST',
    body: { expectedChecksumSha256: mp4Sha256 }
  });
  assert.equal(completeRes.status, 201);
  const { data: movieAsset } = await completeRes.json();

  // Duplicate finalization must return 409
  assert.equal((await apiCall(`/media/uploads/${uploadSession.id}/complete`, {
    method: 'POST',
    body: {}
  })).status, 409);

  // Wait for FFprobe + FFmpeg validation and thumbnail generation
  const readyMovie = await waitForAssetStatus(movieAsset.id, ['READY']);
  assert.equal(readyMovie.kind, 'VIDEO');
  assert.equal(readyMovie.videoCodec, 'h264');
  assert.equal(readyMovie.audioCodec, 'aac');
  assert.equal(readyMovie.width, 1920);
  assert.equal(readyMovie.height, 1080);
  assert.equal(readyMovie.broadcastCompatibility, 'DIRECT_PLAYBACK');
  assert.ok(readyMovie.durationSeconds >= 2.0);
  assert.ok(readyMovie.thumbnailKey);

  // Thumbnail and Range preview delivery
  const thumbRes = await apiCall(`/media/assets/${readyMovie.id}/thumbnail`);
  assert.equal(thumbRes.status, 200);
  assert.equal(thumbRes.headers.get('Content-Type'), 'image/jpeg');
  assert.ok((await thumbRes.arrayBuffer()).byteLength > 100);

  const rangePreview = await apiCall(`/media/assets/${readyMovie.id}/preview`, {
    headers: { Range: 'bytes=0-127' }
  });
  assert.equal(rangePreview.status, 206);
  assert.equal((await rangePreview.arrayBuffer()).byteLength, 128);

  // Cross-tenant isolation on asset read, preview, thumbnail, and delete
  assert.equal((await apiCall(`/media/assets/${readyMovie.id}`, { token: foreignToken })).status, 404);
  assert.equal((await apiCall(`/media/assets/${readyMovie.id}/preview`, { token: foreignToken })).status, 404);
  assert.equal((await apiCall(`/media/assets/${readyMovie.id}/thumbnail`, { token: foreignToken })).status, 404);
  assert.equal((await apiCall(`/media/assets/${readyMovie.id}?confirm=true`, { method: 'DELETE', token: foreignToken })).status, 404);

  // 3. Valid Audio (MP3) and Image (PNG) uploads
  async function quickUpload(bytes, title, category, filename) {
    const init = await (await apiCall('/media/uploads', {
      method: 'POST',
      body: { title, category, originalFilename: filename, expectedSizeBytes: bytes.length }
    })).json();
    await apiCall(`/media/uploads/${init.data.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/offset+octet-stream', 'Upload-Offset': '0' },
      body: bytes
    });
    const fin = await (await apiCall(`/media/uploads/${init.data.id}/complete`, { method: 'POST', body: {} })).json();
    return await waitForAssetStatus(fin.data.id, ['READY', 'FAILED', 'QUARANTINED']);
  }

  const readyAudio = await quickUpload(mp3Bytes, 'Morning Theme MP3', 'MUSIC', 'theme.mp3');
  assert.equal(readyAudio.processingStatus, 'READY');
  assert.equal(readyAudio.kind, 'AUDIO');
  assert.equal(readyAudio.audioCodec, 'mp3');
  assert.equal(readyAudio.broadcastCompatibility, 'DIRECT_PLAYBACK');

  const readyLogo = await quickUpload(pngBytes, 'Channel 1 HD Logo', 'CHANNEL_LOGOS', 'logo.png');
  assert.equal(readyLogo.processingStatus, 'READY');
  assert.equal(readyLogo.kind, 'IMAGE');
  assert.equal(readyLogo.width, 320);
  assert.equal(readyLogo.height, 180);

  // 4. MIME Spoofing & Corrupted Media Detection
  const spoofedExe = Buffer.from('MZ\x90\x00\x03\x00\x00\x00Fake executable pretending to be MP4 video');
  const quarantinedAsset = await quickUpload(spoofedExe, 'Spoofed File', 'MOVIES', 'spoofed.mp4');
  assert.equal(quarantinedAsset.processingStatus, 'QUARANTINED');
  assert.equal(quarantinedAsset.broadcastCompatibility, 'UNSUPPORTED');
  assert.match(quarantinedAsset.storageKey, /^quarantine\//);
  // Quarantined media cannot be previewed
  assert.equal((await apiCall(`/media/assets/${quarantinedAsset.id}/preview`)).status, 404);

  const corruptedMp4 = Buffer.concat([Buffer.from([0x00, 0x00, 0x00, 0x18]), Buffer.from('ftypmp42'), randomBytes(256)]);
  const failedAsset = await quickUpload(corruptedMp4, 'Corrupted MP4', 'MOVIES', 'corrupt.mp4');
  assert.equal(failedAsset.processingStatus, 'FAILED');
  assert.equal(failedAsset.broadcastCompatibility, 'UNSUPPORTED');

  // 5. Authorized Server Directory Import & Path Traversal / Symlink Rejection
  const listDirRes = await apiCall('/media/import/directory');
  assert.equal(listDirRes.status, 200);
  assert.ok((await listDirRes.json()).data.some(f => f.filename === 'server-clip.mkv'));

  for (const traversal of ['../outside-secret.txt', '..\\outside-secret.txt', '/etc/passwd', 'sub/../../outside-secret.txt']) {
    const deniedImport = await apiCall('/media/import/directory', {
      method: 'POST',
      body: { relativeFilename: traversal, category: 'VIDEO_CLIPS' }
    });
    assert.ok([400, 404].includes(deniedImport.status), `Traversal ${traversal} must be rejected`);
  }

  let symlinkCreated = false;
  const symlinkPath = join(importDir, 'symlink-clip.mkv');
  try {
    await symlink(sampleMkvPath, symlinkPath);
    symlinkCreated = true;
  } catch {
    // Windows without developer mode may disallow symlink creation itself.
  }
  if (symlinkCreated) {
    const symImport = await apiCall('/media/import/directory', {
      method: 'POST',
      body: { relativeFilename: 'symlink-clip.mkv', category: 'VIDEO_CLIPS' }
    });
    assert.equal(symImport.status, 404);
  }

  const validDirImport = await apiCall('/media/import/directory', {
    method: 'POST',
    body: { relativeFilename: 'server-clip.mkv', title: 'Imported MKV Clip', category: 'VIDEO_CLIPS' }
  });
  assert.equal(validDirImport.status, 201);
  const importedMkv = await waitForAssetStatus((await validDirImport.json()).data.id, ['READY']);
  assert.equal(importedMkv.containerFormat, 'mkv');
  assert.equal(importedMkv.broadcastCompatibility, 'REMUX_REQUIRED');

  // 6. Remote URL Import & SSRF Protection
  for (const deniedUrl of [
    'http://169.254.169.254/latest/meta-data/',
    'https://169.254.169.254/latest/meta-data/',
    'https://localhost/media.mp4',
    'https://internal.local/media.mp4',
    'https://10.0.0.1/media.mp4',
    'https://192.168.1.1/media.mp4',
    `${remoteOrigin}/redirect`
  ]) {
    const ssrfRes = await apiCall('/media/import/url', {
      method: 'POST',
      body: { url: deniedUrl, category: 'AUDIO_RECORDINGS' }
    });
    assert.equal(ssrfRes.status, 400, `SSRF URL ${deniedUrl} must be rejected`);
  }

  const validUrlImport = await apiCall('/media/import/url', {
    method: 'POST',
    body: { url: `${remoteOrigin}/audio.wav`, title: 'Remote WAV Recording', category: 'AUDIO_RECORDINGS' }
  });
  assert.equal(validUrlImport.status, 201);
  const importedWav = await waitForAssetStatus((await validUrlImport.json()).data.id, ['READY']);
  assert.equal(importedWav.kind, 'AUDIO');
  assert.equal(importedWav.containerFormat, 'wav');
  assert.equal(importedWav.broadcastCompatibility, 'TRANSCODE_REQUIRED');

  // 7. Upload Cancellation, Expiration, Low Disk Space, and Quota Enforcement
  const cancelInit = await (await apiCall('/media/uploads', {
    method: 'POST',
    body: { title: 'To Cancel', category: 'MOVIES', originalFilename: 'cancel.mp4', expectedSizeBytes: 1024 * 1024 }
  })).json();
  assert.equal((await apiCall(`/media/uploads/${cancelInit.data.id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await apiCall(`/media/uploads/${cancelInit.data.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/offset+octet-stream', 'Upload-Offset': '0' },
    body: Buffer.alloc(1024)
  })).status, 409);

  // Expire an upload session and verify 410 Gone
  const expInit = await (await apiCall('/media/uploads', {
    method: 'POST',
    body: { title: 'To Expire', category: 'MOVIES', originalFilename: 'expire.mp4', expectedSizeBytes: 1024 }
  })).json();
  db.prepare('UPDATE media_upload_sessions SET expiresAt = ? WHERE id = ?').run(Date.now() - 1000, expInit.data.id);
  assert.equal((await apiCall(`/media/uploads/${expInit.data.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/offset+octet-stream', 'Upload-Offset': '0' },
    body: Buffer.alloc(512)
  })).status, 410);

  // Quota enforcement: org quota is 32 MiB, max file size is 24 MiB. Two 18 MiB reservations must reject the second with 409.
  const res18A = await apiCall('/media/uploads', {
    method: 'POST',
    body: { title: 'Quota A', category: 'MOVIES', originalFilename: 'qa.mp4', expectedSizeBytes: 18 * 1024 ** 2 }
  });
  assert.equal(res18A.status, 201);
  const session18A = (await res18A.json()).data;

  const res18B = await apiCall('/media/uploads', {
    method: 'POST',
    body: { title: 'Quota B', category: 'MOVIES', originalFilename: 'qb.mp4', expectedSizeBytes: 18 * 1024 ** 2 }
  });
  assert.equal(res18B.status, 409);
  await apiCall(`/media/uploads/${session18A.id}`, { method: 'DELETE' });

  // Simulated Low Disk Space rejection (507 Insufficient Storage)
  process.env.MCR_TEST_SIMULATED_FREE_DISK_BYTES = String(4 * 1024 ** 2); // 4 MiB free < 16 MiB min
  const lowDiskRes = await apiCall('/media/uploads', {
    method: 'POST',
    body: { title: 'Low Disk', category: 'MOVIES', originalFilename: 'low.mp4', expectedSizeBytes: 1024 * 1024 }
  });
  assert.equal(lowDiskRes.status, 507);
  delete process.env.MCR_TEST_SIMULATED_FREE_DISK_BYTES;

  // 8. Server-side Pagination, Filtering, Sorting & Search
  const page1Res = await apiCall('/media/assets?page=1&pageSize=2&sortBy=sizeBytes&sortOrder=desc');
  assert.equal(page1Res.status, 200);
  const page1 = (await page1Res.json()).data;
  assert.equal(page1.items.length, 2);
  assert.ok(page1.pagination.total >= 5);
  assert.ok(page1.items[0].sizeBytes >= page1.items[1].sizeBytes);

  const filteredCat = await (await apiCall('/media/assets?category=MUSIC')).json();
  assert.equal(filteredCat.data.items.length, 1);
  assert.equal(filteredCat.data.items[0].id, readyAudio.id);

  // 9. Playlists & Lifecycle Reference Protection on Deletion
  // Quarantined asset cannot be added to a playlist
  assert.equal((await apiCall('/media/playlists', {
    method: 'POST',
    body: { name: 'Bad Playlist', kind: 'VIDEO', items: [{ assetId: quarantinedAsset.id }] }
  })).status, 409);

  // Valid playlist referencing readyMovie
  const plRes = await apiCall('/media/playlists', {
    method: 'POST',
    body: { name: 'Prime Time Movies', kind: 'VIDEO', channelId: station.id, items: [{ assetId: readyMovie.id, order: 0 }] }
  });
  assert.equal(plRes.status, 201);
  const playlist = (await plRes.json()).data;

  // Deletion without confirm=true must return 400
  assert.equal((await apiCall(`/media/assets/${readyMovie.id}`, { method: 'DELETE' })).status, 400);

  // Deletion while referenced by a playlist must return 409
  const blockedByPl = await apiCall(`/media/assets/${readyMovie.id}?confirm=true`, { method: 'DELETE' });
  assert.equal(blockedByPl.status, 409);
  assert.ok((await blockedByPl.json()).error.includes('PLAYLIST_REFERENCE'));

  // Also reference readyMovie in program_schedule and verify SCHEDULED_PLAYBACK block
  db.prepare(`
    INSERT INTO program_schedule (id, stationId, userId, sceneId, scene, dueAt, state)
    VALUES ('sched-ref-1', ?, ?, 'scene-1', ?, ?, 'pending')
  `).run(station.id, operator.id, JSON.stringify({ id: 'scene-1', name: 'Movie Scene', video: readyMovie.id }), Date.now() + 3600000);

  const inspectScheduled = await (await apiCall(`/media/assets/${readyMovie.id}`)).json();
  assert.equal(inspectScheduled.data.references.usageState, 'SCHEDULED');
  assert.equal(inspectScheduled.data.eligibleForDeletion, false);
  assert.ok(inspectScheduled.data.references.blockingReasons.includes('SCHEDULED_PLAYBACK'));

  // Remove schedule & playlist references, then verify safe deletion succeeds and records audit log
  db.prepare("DELETE FROM program_schedule WHERE id = 'sched-ref-1'").run();
  assert.equal((await apiCall(`/media/playlists/${playlist.id}`, { method: 'DELETE' })).status, 200);

  const deleteSuccess = await apiCall(`/media/assets/${readyMovie.id}?confirm=true`, { method: 'DELETE' });
  assert.equal(deleteSuccess.status, 200);
  assert.equal((await apiCall(`/media/assets/${readyMovie.id}`)).status, 404);

  const deleteAudits = db.prepare(
    "SELECT action, resourceId FROM audit_logs WHERE organizationId = 'org-media' AND action = 'MEDIA_ASSET_DELETED'"
  ).all();
  assert.equal(deleteAudits.length, 1);
  assert.equal(deleteAudits[0].resourceId, readyMovie.id);
});
