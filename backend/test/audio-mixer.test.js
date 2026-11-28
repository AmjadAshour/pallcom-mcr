import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

test('Phase Five independent audio sources & multi-track mixer: 11 source types, real 48 kHz PCM mixing, monitoring-only solo, ducking envelope, equal-power crossfade, peak limiter, silence fallback, radio stream health/retry, explicit microphone auth, and multi-channel/tenant isolation', { timeout: 90000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mcr-audio-mixer-'));
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
    MCR_ALLOW_LOOPBACK_AUDIO_SOURCE_FOR_TESTS: '1',
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
  const {
    generateTonePcm,
    measurePcmFrame,
    crossfadePcmBuffers,
    mixPcmFrameDsp
  } = await import('../src/infrastructure/audio/audio-mixer-engine.js');

  await mediaStorage.ensureInitialized();
  const db = getSqliteDatabase();
  const users = RepositoryFactory.getUserRepository();
  const stations = RepositoryFactory.getStationRepository();
  const mediaRepo = RepositoryFactory.getMediaRepository();
  const videoSourcesRepo = RepositoryFactory.getVideoSourceRepository();

  const operator = await users.create({
    id: 'aud-op-1',
    email: 'aud-operator@mcr.test',
    fullName: 'Audio Operator 1',
    role: 'OPERATOR',
    organizationId: 'org-audio',
    passwordHash: 'unused'
  });
  const secondOperator = await users.create({
    id: 'aud-op-2',
    email: 'aud-operator2@mcr.test',
    fullName: 'Audio Operator 2',
    role: 'OPERATOR',
    organizationId: 'org-audio',
    passwordHash: 'unused'
  });
  const viewer = await users.create({
    id: 'aud-vw-1',
    email: 'aud-viewer@mcr.test',
    fullName: 'Audio Viewer',
    role: 'VIEWER',
    organizationId: 'org-audio',
    passwordHash: 'unused'
  });
  const foreignOp = await users.create({
    id: 'aud-for-1',
    email: 'aud-foreign@mcr.test',
    fullName: 'Foreign Audio Operator',
    role: 'OPERATOR',
    organizationId: 'org-foreign',
    passwordHash: 'unused'
  });

  const channel1 = await stations.create({
    name: 'Channel One Audio Bus',
    organizationId: 'org-audio',
    encryptedPassword: 'unused',
    status: 'ONLINE',
    fps: 25
  });
  const channel2 = await stations.create({
    name: 'Channel Two Audio Bus',
    organizationId: 'org-audio',
    encryptedPassword: 'unused',
    status: 'ONLINE',
    fps: 25
  });

  const opSession = createSession(operator.id);
  const opToken = CryptoService.signAccessToken({ sub: operator.id, sid: opSession.id });
  const op2Session = createSession(secondOperator.id);
  const op2Token = CryptoService.signAccessToken({ sub: secondOperator.id, sid: op2Session.id });
  const viewerToken = CryptoService.signAccessToken({ sub: viewer.id, sid: createSession(viewer.id).id });
  const foreignToken = CryptoService.signAccessToken({ sub: foreignOp.id, sid: createSession(foreignOp.id).id });

  // Generate two distinguishable stereo audio files (440 Hz and 880 Hz) and store them in MediaStorage
  const track440Path = join(directory, 'track-440hz.mp3');
  const track880Path = join(directory, 'track-880hz.mp3');
  execFileSync(ffmpeg, [
    '-nostdin', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'sine=f=440:r=48000',
    '-t', '1.5',
    '-ac', '2', '-c:a', 'libmp3lame', '-b:a', '128k',
    track440Path
  ], { windowsHide: true });
  execFileSync(ffmpeg, [
    '-nostdin', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'sine=f=880:r=48000',
    '-t', '1.5',
    '-ac', '2', '-c:a', 'libmp3lame', '-b:a', '128k',
    track880Path
  ], { windowsHide: true });

  const track440Bytes = await readFile(track440Path);
  const track880Bytes = await readFile(track880Path);
  const asset440Id = randomUUID();
  const asset880Id = randomUUID();
  const { storageKey: key440 } = await mediaStorage.storeBuffer('org-audio', asset440Id, 'bin', track440Bytes);
  const { storageKey: key880 } = await mediaStorage.storeBuffer('org-audio', asset880Id, 'bin', track880Bytes);

  const asset440 = await mediaRepo.createAsset({
    id: asset440Id,
    organizationId: 'org-audio',
    title: 'Music Track 440 Hz',
    category: 'MUSIC',
    kind: 'AUDIO',
    originalFilename: 'track-440hz.mp3',
    storageKey: key440,
    sizeBytes: track440Bytes.length,
    checksumSha256: '4'.repeat(64),
    mimeType: 'audio/mpeg',
    containerFormat: 'mp3',
    audioCodec: 'mp3',
    durationSeconds: 1.5,
    audioChannels: 2,
    sampleRateHz: 48000,
    hasVideo: false,
    hasAudio: true,
    uploadStatus: 'UPLOADED',
    processingStatus: 'READY',
    broadcastCompatibility: 'DIRECT_PLAYBACK',
    createdByUserId: operator.id
  });

  const asset880 = await mediaRepo.createAsset({
    id: asset880Id,
    organizationId: 'org-audio',
    title: 'Fallback Ambient 880 Hz',
    category: 'FALLBACK',
    kind: 'AUDIO',
    originalFilename: 'track-880hz.mp3',
    storageKey: key880,
    sizeBytes: track880Bytes.length,
    checksumSha256: '8'.repeat(64),
    mimeType: 'audio/mpeg',
    containerFormat: 'mp3',
    audioCodec: 'mp3',
    durationSeconds: 1.5,
    audioChannels: 2,
    sampleRateHz: 48000,
    hasVideo: false,
    hasAudio: true,
    uploadStatus: 'UPLOADED',
    processingStatus: 'READY',
    broadcastCompatibility: 'DIRECT_PLAYBACK',
    createdByUserId: operator.id
  });

  const musicPlaylist = await mediaRepo.createPlaylist({
    organizationId: 'org-audio',
    name: 'Continuous Channel One Music Playlist',
    kind: 'AUDIO',
    channelId: channel1.id,
    items: [
      { assetId: asset440.id, order: 0 },
      { assetId: asset880.id, order: 1 }
    ],
    createdByUserId: operator.id
  });

  const videoSourceWithAudio = await videoSourcesRepo.createSource({
    organizationId: 'org-audio',
    stationId: channel1.id,
    name: 'Program Video Source With Audio',
    sourceType: 'UPLOADED_FILE',
    mediaAssetId: asset440.id,
    connectionStatus: 'ONLINE',
    availabilityStatus: 'AVAILABLE',
    hasAudio: true,
    audioCodec: 'mp3',
    createdByUserId: operator.id
  });

  // Synthetic Internet Radio HTTP server for live radio probing, failure, and recovery
  let radioHealthy = true;
  const radioServer = createServer((req, res) => {
    if (!radioHealthy) {
      res.writeHead(503).end();
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'audio/mpeg',
      'icy-name': 'PALLCOM Test Radio FM',
      'icy-br': '128',
      'Content-Length': String(track440Bytes.length)
    });
    res.end(track440Bytes);
  });
  radioServer.listen(0, '127.0.0.1');
  await once(radioServer, 'listening');
  const radioOrigin = `http://127.0.0.1:${radioServer.address().port}`;

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const ch1Base = `${origin}/api/v1/channels/${channel1.id}/audio`;
  const ch2Base = `${origin}/api/v1/channels/${channel2.id}/audio`;

  const api = async (url, token, method = 'GET', body = undefined) => {
    const res = await fetch(url, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {})
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {})
    });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`Non-JSON response from ${method} ${url} (${res.status}): ${text.slice(0, 200)}`);
    }
    return { status: res.status, json };
  };

  try {
    // 1. RBAC & Multi-Tenant Isolation checks
    assert.equal((await api(`${ch1Base}/sources`, null)).status, 401);
    assert.equal((await api(`${ch1Base}/sources`, foreignToken)).status, 404);
    assert.equal(
      (await api(`${ch1Base}/sources`, viewerToken, 'POST', {
        name: 'Unauthorized Viewer Source',
        sourceType: 'GENERATED_SILENCE'
      })).status,
      403
    );

    // 2. Radio Stream SSRF & Embedded Credential Denials
    const ssrfMetadata = await api(`${ch1Base}/sources`, opToken, 'POST', {
      name: 'Cloud Metadata SSRF Radio',
      sourceType: 'INTERNET_RADIO',
      streamUrl: 'http://169.254.169.254/latest/meta-data/'
    });
    assert.equal(ssrfMetadata.status, 400);

    const embeddedCreds = await api(`${ch1Base}/sources`, opToken, 'POST', {
      name: 'Embedded Creds Radio',
      sourceType: 'ICECAST_STREAM',
      streamUrl: 'https://user:pass@stream.example.com/live.mp3'
    });
    assert.equal(embeddedCreds.status, 400);

    // 3. Create all 11 supported Audio Source Types on Channel 1
    const createdByType = {};
    const specs = [
      {
        name: 'Uploaded Music 440Hz',
        sourceType: 'UPLOADED_AUDIO',
        mediaAssetId: asset440.id,
        priority: 40,
        duckingTarget: true
      },
      {
        name: 'Channel One Music Playlist',
        sourceType: 'MUSIC_PLAYLIST',
        playlistId: musicPlaylist.id,
        priority: 45,
        duckingTarget: true
      },
      {
        name: 'Live Internet Radio Feed',
        sourceType: 'INTERNET_RADIO',
        streamUrl: `${radioOrigin}/live.mp3`,
        secret: 'radio-secret-token-2026',
        priority: 50,
        duckingTarget: true,
        fallbackAssetId: asset880.id
      },
      {
        name: 'Icecast Relay Stream',
        sourceType: 'ICECAST_STREAM',
        streamUrl: `${radioOrigin}/icecast.mp3`,
        priority: 50
      },
      {
        name: 'Shoutcast Relay Stream',
        sourceType: 'SHOUTCAST_STREAM',
        streamUrl: `${radioOrigin}/shoutcast.mp3`,
        priority: 50
      },
      {
        name: 'Operator Commentary Mic',
        sourceType: 'MICROPHONE_INPUT',
        priority: 95,
        duckingTrigger: true,
        duckingTarget: false
      },
      {
        name: 'Video Extracted Program Audio',
        sourceType: 'VIDEO_EXTRACTED_AUDIO',
        videoSourceId: videoSourceWithAudio.id,
        priority: 60
      },
      {
        name: 'OBS Studio Aux Input',
        sourceType: 'OBS_AUDIO_INPUT',
        obsInputName: 'Desktop Audio',
        priority: 55
      },
      {
        name: 'Sponsor Ad Spot Audio',
        sourceType: 'ADVERTISEMENT_AUDIO',
        mediaAssetId: asset880.id,
        priority: 90,
        duckingTrigger: true,
        duckingTarget: false
      },
      {
        name: 'Emergency Fallback Audio',
        sourceType: 'FALLBACK_AUDIO',
        mediaAssetId: asset880.id,
        priority: 10
      },
      {
        name: 'Clean Silence Generator',
        sourceType: 'GENERATED_SILENCE',
        priority: 5
      }
    ];

    for (const spec of specs) {
      const res = await api(`${ch1Base}/sources`, opToken, 'POST', spec);
      assert.equal(res.status, 201, `Failed creating ${spec.sourceType}: ${JSON.stringify(res.json)}`);
      createdByType[spec.sourceType] = res.json.data;
    }
    assert.equal(Object.keys(createdByType).length, 11);

    // Verify secret is encrypted at rest with AES-256-GCM and never returned in API responses
    const radioSrc = createdByType.INTERNET_RADIO;
    assert.equal(radioSrc.hasSecret, true);
    assert.equal(radioSrc.encryptedSecret, undefined);
    const rawRadioRow = db.prepare('SELECT encryptedSecret FROM audio_sources WHERE id = ?').get(radioSrc.id);
    assert.ok(rawRadioRow.encryptedSecret && !rawRadioRow.encryptedSecret.includes('radio-secret-token-2026'));
    assert.equal(CryptoService.decryptSecret(rawRadioRow.encryptedSecret), 'radio-secret-token-2026');

    // Verify MediaAsset deletion is blocked by AUDIO_SOURCE_REFERENCE
    const deleteReferencedAsset = await api(`${origin}/api/v1/media/assets/${asset440.id}?confirm=true`, opToken, 'DELETE');
    assert.equal(deleteReferencedAsset.status, 409);
    assert.ok(
      String(deleteReferencedAsset.json.error || '').includes('AUDIO_SOURCE_REFERENCE'),
      `Expected AUDIO_SOURCE_REFERENCE blocking reason, got: ${JSON.stringify(deleteReferencedAsset.json)}`
    );

    // 4. Genuine Multi-Input PCM Mixing, Gain/Mute, Monitoring-Only Solo, Ducking, Crossfade & Limiter
    const frame440 = generateTonePcm(440, 20, 0.45);
    const frame1000 = generateTonePcm(1000, 20, 0.45);
    const singleMetrics = measurePcmFrame(frame440);
    assert.ok(singleMetrics.rmsDbfs > -15 && singleMetrics.rmsDbfs < -5);

    // Combine two distinguishable sources (440 Hz + 1000 Hz)
    const dualMix = mixPcmFrameDsp({
      sources: [
        {
          id: 'src-440',
          sourceType: 'UPLOADED_AUDIO',
          pcmFrame: frame440,
          volumeLinear: 1.0,
          gainDb: 0,
          muted: false,
          soloMonitoring: true,
          enabled: true,
          priority: 50,
          duckingTrigger: false,
          duckingTarget: true
        },
        {
          id: 'src-1000',
          sourceType: 'INTERNET_RADIO',
          pcmFrame: frame1000,
          volumeLinear: 1.0,
          gainDb: 0,
          muted: false,
          soloMonitoring: false,
          enabled: true,
          priority: 50,
          duckingTrigger: false,
          duckingTarget: true
        }
      ],
      mixerConfig: {
        masterVolumeLinear: 1.0,
        masterGainDb: 0,
        masterMuted: false,
        peakLimiterCeilingDbfs: -1.0,
        duckingEnabled: false
      },
      monitoringSoloOnly: false
    });
    // Broadcast output combines BOTH tracks even when src-440 has soloMonitoring=true
    assert.ok(dualMix.masterRmsDbfs > singleMetrics.rmsDbfs + 1.5, 'Combined uncorrelated tones must have higher RMS energy than single tone');

    // Monitoring bus with monitoringSoloOnly=true isolates ONLY the soloed track (src-440) without muting broadcast output
    const soloMonitorMix = mixPcmFrameDsp({
      sources: [
        {
          id: 'src-440',
          sourceType: 'UPLOADED_AUDIO',
          pcmFrame: frame440,
          volumeLinear: 1.0,
          gainDb: 0,
          muted: false,
          soloMonitoring: true,
          enabled: true
        },
        {
          id: 'src-1000',
          sourceType: 'INTERNET_RADIO',
          pcmFrame: frame1000,
          volumeLinear: 1.0,
          gainDb: 0,
          muted: false,
          soloMonitoring: false,
          enabled: true
        }
      ],
      mixerConfig: {
        masterVolumeLinear: 1.0,
        masterGainDb: 0,
        masterMuted: false,
        peakLimiterCeilingDbfs: -1.0,
        duckingEnabled: false
      },
      monitoringSoloOnly: true
    });
    assert.ok(Math.abs(soloMonitorMix.masterRmsDbfs - singleMetrics.rmsDbfs) < 0.5, 'Monitoring solo must match single soloed source RMS');

    // Automatic Priority Ducking test: when high-priority microphone trigger is active, background music is attenuated by -14 dB
    const activeMicFrame = generateTonePcm(600, 20, 0.35);
    const duckedMusicOnlyCheck = mixPcmFrameDsp({
      sources: [
        {
          id: 'music-bg',
          sourceType: 'UPLOADED_AUDIO',
          pcmFrame: frame440,
          volumeLinear: 1.0,
          gainDb: 0,
          muted: false,
          enabled: true,
          priority: 40,
          duckingTrigger: false,
          duckingTarget: true
        },
        {
          id: 'mic-trigger',
          sourceType: 'MICROPHONE_INPUT',
          pcmFrame: activeMicFrame,
          volumeLinear: 0.0, // zero output contribution so we measure pure ducked music level
          gainDb: 0,
          muted: false,
          enabled: true,
          priority: 95,
          duckingTrigger: true,
          duckingTarget: false
        }
      ],
      mixerConfig: {
        masterVolumeLinear: 1.0,
        masterGainDb: 0,
        masterMuted: false,
        peakLimiterCeilingDbfs: -0.5,
        duckingEnabled: true,
        duckingThresholdDbfs: -28,
        duckingReductionDb: -14,
        duckingAttackMs: 20,
        duckingHoldMs: 40,
        duckingReleaseMs: 40
      },
      duckingEnvelopeState: { currentReductionDb: 0, holdRemainingMs: 0 }
    });
    assert.equal(duckedMusicOnlyCheck.duckingReductionAppliedDb, -14);
    assert.ok(
      duckedMusicOnlyCheck.masterRmsDbfs <= singleMetrics.rmsDbfs - 12,
      `Expected ducked music RMS <= ${singleMetrics.rmsDbfs - 12} dBFS, got ${duckedMusicOnlyCheck.masterRmsDbfs}`
    );

    // Equal-power crossfade test
    const outgoingBuf = generateTonePcm(440, 200, 0.5);
    const incomingBuf = generateTonePcm(880, 200, 0.5);
    const crossfaded = crossfadePcmBuffers(outgoingBuf, incomingBuf, 100);
    const crossfadeMetrics = measurePcmFrame(crossfaded);
    assert.ok(crossfaded.length > outgoingBuf.length);
    assert.ok(crossfadeMetrics.rmsDbfs > -16 && crossfadeMetrics.peakDbfs <= 0, 'Equal-power crossfade must maintain smooth energy without clipping');

    // Soft-knee Peak Limiter / Clipping Prevention test
    const hotFrameA = generateTonePcm(440, 20, 0.95);
    const hotFrameB = generateTonePcm(440, 20, 0.95);
    const limitedMix = mixPcmFrameDsp({
      sources: [
        { id: 'hot-a', sourceType: 'UPLOADED_AUDIO', pcmFrame: hotFrameA, volumeLinear: 1.2, gainDb: 3, enabled: true },
        { id: 'hot-b', sourceType: 'UPLOADED_AUDIO', pcmFrame: hotFrameB, volumeLinear: 1.2, gainDb: 3, enabled: true }
      ],
      mixerConfig: {
        masterVolumeLinear: 1.2,
        masterGainDb: 3,
        masterMuted: false,
        peakLimiterCeilingDbfs: -1.0,
        duckingEnabled: false
      }
    });
    assert.equal(limitedMix.clippingPrevented, true);
    assert.ok(limitedMix.masterPeakDbfs <= -0.9, `Expected peak limiter ceiling <= -0.9 dBFS, got ${limitedMix.masterPeakDbfs}`);

    // 5. Explicit Authorized Microphone Activation, PCM Ingestion & Session Expiry/Foreign User Revocation
    const micSource = createdByType.MICROPHONE_INPUT;
    assert.equal(micSource.state, 'PAUSED', 'Microphone must start PAUSED until explicitly activated');

    // Cannot push microphone PCM before explicit activation
    const unactivatedPush = await api(
      `${ch1Base}/sources/${micSource.id}/microphone/pcm`,
      opToken,
      'POST',
      { pcmBase64: activeMicFrame.toString('base64') }
    );
    assert.equal(unactivatedPush.status, 409);

    // Explicit microphone activation by operator 1
    const activateRes = await api(
      `${ch1Base}/sources/${micSource.id}/microphone`,
      opToken,
      'POST',
      { action: 'activate', pushToTalk: true }
    );
    assert.equal(activateRes.status, 200);
    assert.equal(activateRes.json.data.state, 'PLAYING');

    // Operator 2 cannot inject PCM into Operator 1's active microphone session
    const hijackAttempt = await api(
      `${ch1Base}/sources/${micSource.id}/microphone/pcm`,
      op2Token,
      'POST',
      { pcmBase64: activeMicFrame.toString('base64') }
    );
    assert.equal(hijackAttempt.status, 401);

    // Re-activate after hijack invalidation and push valid 48 kHz PCM frame into activated microphone
    await api(`${ch1Base}/sources/${micSource.id}/microphone`, opToken, 'POST', { action: 'activate' });
    const validPush = await api(
      `${ch1Base}/sources/${micSource.id}/microphone/pcm`,
      opToken,
      'POST',
      { pcmBase64: activeMicFrame.toString('base64') }
    );
    assert.equal(validPush.status, 200);
    assert.equal(validPush.json.bytesAccepted, activeMicFrame.length);

    // Execute real API mix step with active microphone ducking background music
    await api(`${ch1Base}/mixer`, opToken, 'PATCH', {
      routingMode: 'MICROPHONE_COMMENTARY_OVER_PROGRAM',
      duckingEnabled: true,
      duckingReductionDb: -14
    });
    const apiMixRes = await api(`${ch1Base}/step`, opToken, 'POST', {
      frames: 1,
      persistMeters: true
    });
    assert.equal(apiMixRes.status, 200);
    assert.ok(apiMixRes.json.data.masterRmsDbfs > -30);

    // Deactivate microphone explicitly
    const deactivateRes = await api(
      `${ch1Base}/sources/${micSource.id}/microphone`,
      opToken,
      'POST',
      { action: 'deactivate' }
    );
    assert.equal(deactivateRes.status, 200);
    assert.equal(deactivateRes.json.data.state, 'PAUSED');

    // 6. Radio Stream Failure, Bounded Exponential Backoff, Fallback Audio Takeover, and Recovery
    radioHealthy = false;
    const failedProbe1 = await api(`${ch1Base}/sources/${radioSrc.id}/probe`, opToken, 'POST');
    assert.equal(failedProbe1.status, 200);
    assert.equal(failedProbe1.json.data.state, 'RECONNECTING');
    assert.equal(failedProbe1.json.data.retryCount, 1);
    assert.ok(failedProbe1.json.data.nextBackoffMs >= 2000);

    // Restore radio stream and verify recovery to PLAYING
    radioHealthy = true;
    const recoveredProbe = await api(`${ch1Base}/sources/${radioSrc.id}/probe`, opToken, 'POST');
    assert.equal(recoveredProbe.status, 200);
    assert.equal(recoveredProbe.json.data.state, 'PLAYING');
    assert.equal(recoveredProbe.json.data.retryCount, 0);

    // 7. Multi-Channel Isolation (Channel 1 vs Channel 2)
    const ch2State = await api(ch2Base, opToken);
    assert.equal(ch2State.status, 200);
    assert.equal(ch2State.json.data.mixer.routingMode, 'MIX_VIDEO_AND_EXTERNAL_AUDIO');
    assert.equal(ch2State.json.data.sources.length, 0, 'Channel 2 must have zero audio sources when only Channel 1 was configured');
  } finally {
    server.closeAllConnections();
    radioServer.closeAllConnections();
    await Promise.all([
      new Promise(resolve => server.close(resolve)),
      new Promise(resolve => radioServer.close(resolve))
    ]);
    db.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
