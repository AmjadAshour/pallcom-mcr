import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';

test('Phase Four unified video sources: 10 source types, SSRF/DRM defense, encrypted secrets, health probing, retry backoff, and fallback activation', { timeout: 90000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'mcr-video-sources-'));
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
    MCR_ALLOW_LOOPBACK_VIDEO_SOURCE_FOR_TESTS: '1',
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
    id: 'vs-op-1',
    email: 'vs-operator@mcr.test',
    fullName: 'Video Source Operator',
    role: 'OPERATOR',
    organizationId: 'org-sources',
    passwordHash: 'unused'
  });
  const viewer = await users.create({
    id: 'vs-vw-1',
    email: 'vs-viewer@mcr.test',
    fullName: 'Video Source Viewer',
    role: 'VIEWER',
    organizationId: 'org-sources',
    passwordHash: 'unused'
  });
  const foreignOp = await users.create({
    id: 'vs-for-1',
    email: 'vs-foreign@mcr.test',
    fullName: 'Foreign Operator',
    role: 'OPERATOR',
    organizationId: 'org-foreign',
    passwordHash: 'unused'
  });

  const station = await stations.create({
    name: 'Camera Rotation Channel 1',
    organizationId: 'org-sources',
    encryptedPassword: 'unused',
    status: 'ONLINE',
    fps: 25
  });

  const opToken = CryptoService.signAccessToken({ sub: operator.id, sid: createSession(operator.id).id });
  const viewerToken = CryptoService.signAccessToken({ sub: viewer.id, sid: createSession(viewer.id).id });
  const foreignToken = CryptoService.signAccessToken({ sub: foreignOp.id, sid: createSession(foreignOp.id).id });

  // Generate a synthetic Full HD 1920x1080 MP4 clip and an HLS (.m3u8 + .ts) stream in directory
  const clipPath = join(directory, 'source-clip.mp4');
  const hlsDir = join(directory, 'hls');
  await import('node:fs/promises').then(fs => fs.mkdir(hlsDir, { recursive: true }));
  const hlsPlaylistPath = join(hlsDir, 'live.m3u8');

  execFileSync(ffmpeg, [
    '-nostdin', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'testsrc2=s=1920x1080:r=25',
    '-f', 'lavfi', '-i', 'sine=f=440:r=48000',
    '-t', '2',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast',
    '-c:a', 'aac', '-ac', '2',
    clipPath
  ], { windowsHide: true });

  execFileSync(ffmpeg, [
    '-nostdin', '-loglevel', 'error',
    '-i', clipPath,
    '-c', 'copy',
    '-f', 'hls',
    '-hls_time', '1',
    '-hls_list_size', '5',
    hlsPlaylistPath
  ], { windowsHide: true });

  const clipBytes = await readFile(clipPath);
  await writeFile(join(importDir, 'authorized-server-movie.mp4'), clipBytes);

  // Local HTTP server serving synthetic HLS and remote MP4 for probing
  let streamHealthy = true;
  const streamServer = createServer(async (req, res) => {
    if (!streamHealthy) {
      res.writeHead(503).end();
      return;
    }
    if (req.url === '/remote.mp4') {
      res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': String(clipBytes.length) });
      res.end(clipBytes);
      return;
    }
    if (req.url?.startsWith('/hls/')) {
      const file = req.url.slice('/hls/'.length);
      if (!/^[a-zA-Z0-9_.-]+$/.test(file)) {
        res.writeHead(404).end();
        return;
      }
      try {
        const bytes = await readFile(join(hlsDir, file));
        res.writeHead(200, {
          'Content-Type': file.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t',
          'Content-Length': String(bytes.length)
        });
        res.end(bytes);
      } catch {
        res.writeHead(404).end();
      }
      return;
    }
    res.writeHead(404).end();
  });
  streamServer.listen(0, '127.0.0.1');
  await once(streamServer, 'listening');
  const streamOrigin = `http://127.0.0.1:${streamServer.address().port}`;

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const root = `http://127.0.0.1:${server.address().port}/api/v1`;

  t.after(async () => {
    delete process.env.MCR_ALLOW_LOOPBACK_VIDEO_SOURCE_FOR_TESTS;
    streamServer.closeAllConnections();
    await new Promise(r => streamServer.close(r));
    server.closeAllConnections();
    await new Promise(r => server.close(r));
    db.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  async function apiCall(path, { method = 'GET', token = opToken, body, headers = {} } = {}) {
    const isBuffer = Buffer.isBuffer(body);
    return fetch(root + path, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body && !isBuffer ? { 'Content-Type': 'application/json' } : {}),
        ...headers
      },
      body: isBuffer ? body : body ? JSON.stringify(body) : undefined
    });
  }

  // Upload and validate one READY movie asset + one VIDEO playlist
  const initRes = await (await apiCall('/media/uploads', {
    method: 'POST',
    body: {
      title: 'Catalog Feature Film',
      category: 'MOVIES',
      originalFilename: 'catalog-film.mp4',
      expectedSizeBytes: clipBytes.length,
      expectedChecksumSha256: createHash('sha256').update(clipBytes).digest('hex')
    }
  })).json();
  await apiCall(`/media/uploads/${initRes.data.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/offset+octet-stream', 'Upload-Offset': '0' },
    body: clipBytes
  });
  const completeAsset = (await (await apiCall(`/media/uploads/${initRes.data.id}/complete`, { method: 'POST', body: {} })).json()).data;

  const waitDeadline = Date.now() + 25000;
  let readyAsset;
  while (Date.now() < waitDeadline) {
    readyAsset = (await (await apiCall(`/media/assets/${completeAsset.id}`)).json()).data;
    if (readyAsset.processingStatus === 'READY') break;
    await sleep(150);
  }
  assert.equal(readyAsset.processingStatus, 'READY');

  const playlist = (await (await apiCall('/media/playlists', {
    method: 'POST',
    body: { name: 'Movie Channel Playlist', kind: 'VIDEO', items: [{ assetId: readyAsset.id, order: 0 }] }
  })).json()).data;

  // 1. RBAC checks: VIEWER can list/get (`station:read`), cannot create/update/probe/delete (`video:manage`)
  assert.equal((await apiCall('/video-sources', { token: null })).status, 401);
  assert.equal((await apiCall('/video-sources', { token: viewerToken })).status, 200);
  assert.equal((await apiCall('/video-sources', {
    method: 'POST',
    token: viewerToken,
    body: { name: 'Viewer Denied', sourceType: 'MOVIE', mediaAssetId: readyAsset.id }
  })).status, 403);

  // 2. Security denials: SSRF, non-public IPs, embedded URL credentials, DRM markers, path traversal
  for (const invalidBody of [
    { name: 'SSRF Metadata', sourceType: 'HLS_STREAM', streamUrl: 'https://169.254.169.254/live/index.m3u8' },
    { name: 'Private IP RTMP', sourceType: 'RTMP_STREAM', streamUrl: 'rtmp://10.0.0.5/live/cam1' },
    { name: 'Private IP RTSP', sourceType: 'RTSP_STREAM', streamUrl: 'rtsp://192.168.1.50:554/stream1' },
    { name: 'Localhost SRT', sourceType: 'SRT_STREAM', streamUrl: 'srt://localhost:9000?mode=caller' },
    { name: 'Listener Mode SRT', sourceType: 'SRT_STREAM', streamUrl: 'srt://93.184.216.34:9000?mode=listener' },
    { name: 'Embedded Credentials', sourceType: 'RTSP_STREAM', streamUrl: 'rtsp://admin:secret@93.184.216.34:554/cam' },
    { name: 'DRM Stream', sourceType: 'HLS_STREAM', streamUrl: `${streamOrigin}/hls/widevine-drm.m3u8` },
    { name: 'Path Traversal File', sourceType: 'SERVER_FILE', serverFilePath: '../outside.mp4' }
  ]) {
    const res = await apiCall('/video-sources', { method: 'POST', body: invalidBody });
    assert.ok([400, 404].includes(res.status), `Expected 400/404 for ${invalidBody.name}, got ${res.status}`);
  }

  // 3. Register all 10 supported video source types
  const createdSources = {};
  for (const payload of [
    { key: 'UPLOADED_FILE', name: 'Uploaded Video Clip', sourceType: 'UPLOADED_FILE', mediaAssetId: readyAsset.id },
    { key: 'MOVIE', name: 'Feature Film 1080p', sourceType: 'MOVIE', mediaAssetId: readyAsset.id },
    { key: 'PLAYLIST', name: '24/7 Movie Playlist', sourceType: 'PLAYLIST', playlistId: playlist.id },
    { key: 'OBS_LIVE', name: 'Studio 1 OBS Live', sourceType: 'OBS_LIVE', stationId: station.id },
    { key: 'SERVER_FILE', name: 'Ingest Server Movie', sourceType: 'SERVER_FILE', serverFilePath: 'authorized-server-movie.mp4' },
    { key: 'HLS_STREAM', name: 'External HLS Feed', sourceType: 'HLS_STREAM', streamUrl: `${streamOrigin}/hls/live.m3u8`, maxRetries: 2, backoffBaseMs: 1000, fallbackMode: 'SLATE' },
    { key: 'REMOTE_VIDEO_URL', name: 'Direct Remote MP4', sourceType: 'REMOTE_VIDEO_URL', streamUrl: `${streamOrigin}/remote.mp4` },
    { key: 'RTMP_STREAM', name: 'External RTMP Feed', sourceType: 'RTMP_STREAM', streamUrl: 'rtmp://93.184.216.34:1935/live/stream1', secret: 'rtmp-stream-key-123' },
    { key: 'SRT_STREAM', name: 'External SRT Feed', sourceType: 'SRT_STREAM', streamUrl: 'srt://93.184.216.34:9000?mode=caller', secret: 'srt-passphrase-12345' },
    { key: 'RTSP_STREAM', name: 'External RTSP Camera', sourceType: 'RTSP_STREAM', streamUrl: 'rtsp://93.184.216.34:554/cam1', secret: 'rtsp-cam-token' }
  ]) {
    const { key, ...body } = payload;
    const res = await apiCall('/video-sources', { method: 'POST', body });
    assert.equal(res.status, 201, `Create ${key} failed`);
    const { data } = await res.json();
    createdSources[key] = data;
    assert.equal(data.sourceType, key);
    if (body.secret) {
      assert.equal(data.hasSecret, true);
      assert.equal(data.encryptedSecret, undefined, 'Encrypted secret must not be exposed in API responses');
      const rawRow = db.prepare('SELECT encryptedSecret FROM video_sources WHERE id = ?').get(data.id);
      assert.notEqual(rawRow.encryptedSecret, body.secret);
      assert.equal(CryptoService.decryptSecret(rawRow.encryptedSecret), body.secret);
    }
  }

  // 4. Cross-organization isolation
  assert.equal((await apiCall(`/video-sources/${createdSources.MOVIE.id}`, { token: foreignToken })).status, 404);
  assert.equal((await apiCall(`/video-sources/${createdSources.MOVIE.id}/probe`, { method: 'POST', token: foreignToken })).status, 404);
  assert.equal((await apiCall(`/video-sources/${createdSources.MOVIE.id}?confirm=true`, { method: 'DELETE', token: foreignToken })).status, 404);

  // 5. Probe live HLS, Remote MP4, and Server File sources via FFprobe and verify 1920x1080 h264/aac detection
  for (const key of ['HLS_STREAM', 'REMOTE_VIDEO_URL', 'SERVER_FILE', 'MOVIE', 'PLAYLIST', 'OBS_LIVE']) {
    const probeRes = await apiCall(`/video-sources/${createdSources[key].id}/probe`, { method: 'POST' });
    assert.equal(probeRes.status, 200, `Probe ${key}`);
    const { data: probed } = await probeRes.json();
    assert.equal(probed.connectionStatus, 'ONLINE', `${key} connectionStatus`);
    assert.equal(probed.availabilityStatus, 'AVAILABLE', `${key} availabilityStatus`);
    assert.equal(probed.width, 1920, `${key} width`);
    assert.equal(probed.height, 1080, `${key} height`);
    assert.equal(probed.videoCodec, 'h264', `${key} videoCodec`);
    assert.equal(probed.hasAudio, true, `${key} hasAudio`);
  }

  // 6. Preview endpoint returns JPEG thumbnail for file/movie sources
  const previewRes = await apiCall(`/video-sources/${createdSources.MOVIE.id}/preview`);
  assert.equal(previewRes.status, 200);
  assert.equal(previewRes.headers.get('Content-Type'), 'image/jpeg');

  // 7. Simulate HLS stream outage and verify bounded retry backoff + automatic FALLBACK_ACTIVE transition
  streamHealthy = false;
  // First failure (retry 1 of 2 -> RECONNECTING, UNAVAILABLE)
  const fail1 = (await (await apiCall(`/video-sources/${createdSources.HLS_STREAM.id}/probe`, { method: 'POST' })).json()).data;
  assert.equal(fail1.retryCount, 1);
  assert.equal(fail1.connectionStatus, 'RECONNECTING');
  assert.equal(fail1.availabilityStatus, 'UNAVAILABLE');
  assert.ok(fail1.nextBackoffMs >= 2000);

  // Second failure reaches maxRetries (2 of 2 -> ERROR, FALLBACK_ACTIVE)
  const fail2 = (await (await apiCall(`/video-sources/${createdSources.HLS_STREAM.id}/probe`, { method: 'POST' })).json()).data;
  assert.equal(fail2.retryCount, 2);
  assert.equal(fail2.connectionStatus, 'ERROR');
  assert.equal(fail2.availabilityStatus, 'FALLBACK_ACTIVE');

  // Restore stream health and verify automatic recovery back to ONLINE / AVAILABLE with retryCount reset to 0
  streamHealthy = true;
  const recovered = (await (await apiCall(`/video-sources/${createdSources.HLS_STREAM.id}/probe`, { method: 'POST' })).json()).data;
  assert.equal(recovered.connectionStatus, 'ONLINE');
  assert.equal(recovered.availabilityStatus, 'AVAILABLE');
  assert.equal(recovered.retryCount, 0);
  assert.equal(recovered.lastError, null);

  // 8. Media asset referenced by a video source cannot be deleted from Media Library
  const blockedMediaDelete = await apiCall(`/media/assets/${readyAsset.id}?confirm=true`, { method: 'DELETE' });
  assert.equal(blockedMediaDelete.status, 409);
  assert.ok((await blockedMediaDelete.json()).error.includes('VIDEO_SOURCE_REFERENCE'));

  // 9. Source configured as fallback for another source cannot be deleted until unassigned
  await apiCall(`/video-sources/${createdSources.HLS_STREAM.id}`, {
    method: 'PATCH',
    body: { fallbackMode: 'SOURCE', fallbackSourceId: createdSources.MOVIE.id }
  });
  assert.equal((await apiCall(`/video-sources/${createdSources.MOVIE.id}?confirm=true`, { method: 'DELETE' })).status, 409);

  await apiCall(`/video-sources/${createdSources.HLS_STREAM.id}`, {
    method: 'PATCH',
    body: { fallbackMode: 'SLATE', fallbackSourceId: null }
  });
  assert.equal((await apiCall(`/video-sources/${createdSources.MOVIE.id}?confirm=true`, { method: 'DELETE' })).status, 200);
});
