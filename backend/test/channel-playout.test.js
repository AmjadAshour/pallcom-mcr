import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

test('Phase Six server-side multi-channel playout engine: RBAC, tenant/channel isolation, revision concurrency, camera VPN allowlist vs SSRF/metadata denial, circular fallback rejection, emergency cut permissions, active media deletion block, and resource admission controls', { timeout: 60000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mcr-channel-playout-test-'));
  const storageRoot = join(directory, 'storage');
  const secret = () => randomBytes(32).toString('hex');

  Object.assign(process.env, {
    NODE_ENV: 'test',
    STORAGE_MODE: 'sqlite',
    SQLITE_DB_PATH: join(directory, 'fixture.sqlite'),
    MCR_MEDIA_STORAGE_ROOT: storageRoot,
    MCR_MEDIA_IMPORT_DIR: join(storageRoot, 'imports'),
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
  const mediaRepo = RepositoryFactory.getMediaRepository();
  const videoSourcesRepo = RepositoryFactory.getVideoSourceRepository();

  const admin = await users.create({
    id: 'pl-adm-1',
    email: 'pl-admin@mcr.test',
    fullName: 'Playout Org Admin',
    role: 'ORG_ADMIN',
    organizationId: 'org-playout',
    passwordHash: 'unused'
  });
  const operator = await users.create({
    id: 'pl-op-1',
    email: 'pl-operator@mcr.test',
    fullName: 'Playout Operator',
    role: 'OPERATOR',
    organizationId: 'org-playout',
    passwordHash: 'unused'
  });
  const viewer = await users.create({
    id: 'pl-vw-1',
    email: 'pl-viewer@mcr.test',
    fullName: 'Playout Viewer',
    role: 'VIEWER',
    organizationId: 'org-playout',
    passwordHash: 'unused'
  });
  const foreignAdmin = await users.create({
    id: 'pl-for-1',
    email: 'pl-foreign@mcr.test',
    fullName: 'Foreign Admin',
    role: 'ORG_ADMIN',
    organizationId: 'org-foreign',
    passwordHash: 'unused'
  });

  const channel1 = await stations.create({
    name: 'Channel One IP Camera Rotation 1080p',
    organizationId: 'org-playout',
    encryptedPassword: 'unused',
    status: 'ONLINE',
    fps: 25
  });
  const channel2 = await stations.create({
    name: 'Channel Two Continuous Movies 1080p',
    organizationId: 'org-playout',
    encryptedPassword: 'unused',
    status: 'ONLINE',
    fps: 25
  });

  const adminToken = CryptoService.signAccessToken({ sub: admin.id, sid: createSession(admin.id).id });
  const opToken = CryptoService.signAccessToken({ sub: operator.id, sid: createSession(operator.id).id });
  const viewerToken = CryptoService.signAccessToken({ sub: viewer.id, sid: createSession(viewer.id).id });
  const foreignToken = CryptoService.signAccessToken({ sub: foreignAdmin.id, sid: createSession(foreignAdmin.id).id });

  const movieAssetId = randomUUID();
  const { storageKey } = await mediaStorage.storeBuffer('org-playout', movieAssetId, 'mp4', Buffer.from('synthetic-movie-bytes'));
  const movieAsset = await mediaRepo.createAsset({
    id: movieAssetId,
    organizationId: 'org-playout',
    title: 'Feature Film 2 Hours 1080p',
    category: 'MOVIES',
    kind: 'VIDEO',
    originalFilename: 'feature-2h.mp4',
    storageKey,
    sizeBytes: 1024,
    checksumSha256: 'f'.repeat(64),
    mimeType: 'video/mp4',
    containerFormat: 'mp4',
    videoCodec: 'h264',
    audioCodec: 'aac',
    width: 1920,
    height: 1080,
    frameRate: 25,
    durationSeconds: 7200,
    hasVideo: true,
    hasAudio: true,
    uploadStatus: 'UPLOADED',
    processingStatus: 'READY',
    broadcastCompatibility: 'DIRECT_PLAYBACK',
    createdByUserId: admin.id
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const ch1Url = `${origin}/api/v1/channels/${channel1.id}/playout`;
  const ch2Url = `${origin}/api/v1/channels/${channel2.id}/playout`;

  const api = async (url, token, method = 'GET', body = undefined) => {
    const res = await fetch(url, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {})
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {})
    });
    const json = await res.json();
    return { status: res.status, json };
  };

  try {
    // 1. Authentication, Tenant Isolation & RBAC checks
    assert.equal((await api(ch1Url, null)).status, 401);
    assert.equal((await api(ch1Url, foreignToken)).status, 404);
    assert.equal((await api(ch1Url, viewerToken)).status, 200);
    // Viewer cannot mutate config, lifecycle, or emergency
    assert.equal((await api(`${ch1Url}/config`, viewerToken, 'PATCH', { playoutMode: 'CAMERA_ROTATION' })).status, 403);
    assert.equal((await api(`${ch1Url}/lifecycle`, viewerToken, 'POST', { action: 'start' })).status, 403);
    assert.equal((await api(`${ch1Url}/emergency`, viewerToken, 'POST', { enabled: true })).status, 403);
    // Operator has station:control & broadcast:emergency, but not station:manage for structural config
    assert.equal((await api(`${ch1Url}/config`, opToken, 'PATCH', { videoBitrateKbps: 5000 })).status, 403);

    // 2. Camera Network Allowlist vs SSRF / Cloud Metadata / Localhost Denial
    // Private VPN camera IP (10.88.10.25) is rejected when NOT in the channel's explicit networkAllowlist
    const unapprovedVpnCam = await api(`${ch1Url}/config`, adminToken, 'PATCH', {
      playoutMode: 'CAMERA_ROTATION',
      cameraSequence: [
        { name: 'Remote VPN Cam 1', uri: 'https://10.88.10.25:8443/cam1.m3u8', durationSeconds: 10 }
      ]
    });
    assert.equal(unapprovedVpnCam.status, 400);

    // Cloud metadata (169.254.169.254) and localhost are ALWAYS rejected even if someone tries to add them to networkAllowlist
    const metadataBypassAttempt = await api(`${ch1Url}/config`, adminToken, 'PATCH', {
      networkAllowlist: [{ host: '169.254.169.254', port: 80 }],
      cameraSequence: [
        { name: 'Metadata SSRF Attempt', uri: 'http://169.254.169.254/latest/meta-data/', durationSeconds: 10 }
      ]
    });
    assert.equal(metadataBypassAttempt.status, 400);

    const localhostBypassAttempt = await api(`${ch1Url}/config`, adminToken, 'PATCH', {
      networkAllowlist: [{ host: 'localhost', port: 8080 }],
      cameraSequence: [
        { name: 'Localhost Attempt', uri: 'http://localhost:8080/live.ts', durationSeconds: 10 }
      ]
    });
    assert.equal(localhostBypassAttempt.status, 400);

    // Explicitly approved WireGuard / dedicated camera network IP+port in networkAllowlist succeeds
    const approvedVpnCam = await api(`${ch1Url}/config`, adminToken, 'PATCH', {
      playoutMode: 'CAMERA_ROTATION',
      width: 1920,
      height: 1080,
      frameRate: 25,
      videoBitrateKbps: 5000,
      networkAllowlist: [{ host: '10.88.10.25', port: 8443, description: 'WireGuard Ramallah Camera VLAN' }],
      cameraSequence: [
        { id: 'cam-1', sourceId: 'cam-1', name: 'Ramallah Square Cam', uri: 'https://10.88.10.25:8443/cam1.m3u8', durationSeconds: 15 },
        { id: 'cam-2', sourceId: 'cam-2', name: 'Nablus Panorama Cam', uri: 'https://93.184.216.34/cam2.m3u8', durationSeconds: 15 }
      ]
    });
    assert.equal(approvedVpnCam.status, 200);
    assert.equal(approvedVpnCam.json.data.config.cameraSequence.length, 2);
    assert.equal(approvedVpnCam.json.data.config.revision, 1);

    // 3. Revision Concurrency Protection (optimistic locking)
    const staleRevision = await api(`${ch1Url}/config`, adminToken, 'PATCH', {
      expectedRevision: 99,
      videoBitrateKbps: 5500
    });
    assert.equal(staleRevision.status, 409);

    // 4. Circular Fallback Hierarchy Rejection
    const srcA = await videoSourcesRepo.createSource({
      organizationId: 'org-playout',
      stationId: channel1.id,
      name: 'Fallback Loop A',
      sourceType: 'OBS_LIVE',
      createdByUserId: admin.id
    });
    const srcB = await videoSourcesRepo.createSource({
      organizationId: 'org-playout',
      stationId: channel1.id,
      name: 'Fallback Loop B',
      sourceType: 'OBS_LIVE',
      fallbackSourceId: srcA.id,
      createdByUserId: admin.id
    });
    // Close the cycle: srcA -> srcB -> srcA in DB directly to test cycle detector
    db.prepare('UPDATE video_sources SET fallbackSourceId = ? WHERE id = ?').run(srcB.id, srcA.id);
    const circularFallbackRes = await api(`${ch1Url}/config`, adminToken, 'PATCH', {
      fallbackConfig: { mode: 'ALTERNATIVE_VIDEO_SOURCE', fallbackSourceId: srcA.id }
    });
    assert.equal(circularFallbackRes.status, 400);

    // 5. Channel Two Configuration, Isolation from Channel One, and Active Broadcast Media Deletion Lock
    const ch2ConfigRes = await api(`${ch2Url}/config`, adminToken, 'PATCH', {
      playoutMode: 'MOVIE_PLAYOUT',
      width: 1920,
      height: 1080,
      frameRate: 25,
      videoBitrateKbps: 4800,
      movieQueue: [
        { id: 'q-1', assetId: movieAsset.id, title: movieAsset.title, durationSeconds: 7200 }
      ],
      movieRepeat: true
    });
    assert.equal(ch2ConfigRes.status, 200);
    assert.equal(ch2ConfigRes.json.data.config.playoutMode, 'MOVIE_PLAYOUT');

    // Verify Channel 1 config was untouched by Channel 2 update
    const ch1Check = await api(ch1Url, adminToken);
    assert.equal(ch1Check.json.data.config.playoutMode, 'CAMERA_ROTATION');

    // Simulate Channel 2 actively broadcasting movieAsset and verify deletion is blocked with 409 ACTIVE_BROADCAST & CHANNEL_PLAYOUT_REFERENCE
    await RepositoryFactory.getChannelPlayoutRepository().updateRuntimeCheckpoint(channel2.id, 'org-playout', {
      runtimeState: 'RUNNING',
      currentMediaAssetId: movieAsset.id
    });
    const deleteActiveMovie = await api(`${origin}/api/v1/media/assets/${movieAsset.id}?confirm=true`, adminToken, 'DELETE');
    assert.equal(deleteActiveMovie.status, 409);
    assert.ok(String(deleteActiveMovie.json.error).includes('ACTIVE_BROADCAST'));
    assert.ok(String(deleteActiveMovie.json.error).includes('CHANNEL_PLAYOUT_REFERENCE'));

    // 6. Emergency Broadcast Override & Security Audit Trail
    const emergencyActivate = await api(`${ch1Url}/emergency`, opToken, 'POST', {
      enabled: true,
      emergencySourceId: null
    });
    assert.equal(emergencyActivate.status, 200);
    assert.equal(emergencyActivate.json.data.config.emergencyActive, true);
    assert.equal(emergencyActivate.json.data.config.runtimeState, 'FALLBACK_ACTIVE');

    const auditRows = await RepositoryFactory.getAuditRepository().findByOrganizationId('org-playout', { limit: 20 });
    assert.ok(auditRows.some(a => a.action === 'CHANNEL_EMERGENCY_ACTIVATED' && a.resourceId === channel1.id));

    // 7. Resource Admission Control (rejects starting a worker when free memory is below minimum threshold)
    process.env.MCR_TEST_SIMULATED_FREE_MEMORY_MB = '64';
    const admissionDenied = await api(`${ch1Url}/lifecycle`, opToken, 'POST', { action: 'start' });
    assert.equal(admissionDenied.status, 503);
    assert.equal(admissionDenied.json.error, 'Service unavailable');
    delete process.env.MCR_TEST_SIMULATED_FREE_MEMORY_MB;
  } finally {
    delete process.env.MCR_TEST_SIMULATED_FREE_MEMORY_MB;
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    db.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
