import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const directory = mkdtempSync(join(tmpdir(), 'mcr-broadcast-scheduler-test-'));
const storageRoot = join(directory, 'storage');
const secret = () => randomBytes(32).toString('hex');

Object.assign(process.env, {
  NODE_ENV: 'test',
  STORAGE_MODE: 'sqlite',
  SQLITE_DB_PATH: join(directory, 'test.sqlite'),
  MCR_MEDIA_STORAGE_ROOT: storageRoot,
  MCR_MEDIA_IMPORT_DIR: join(storageRoot, 'imports'),
  MCR_ALLOW_LOOPBACK_VIDEO_SOURCE_FOR_TESTS: '1',
  MCR_ALLOW_SYNTHETIC_CAMERA_ROTATION_FOR_TESTS: '1',
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
const {
  expandScheduleOccurrences,
  resolveLocalCivilTimeToUtcMs,
  validateScheduleRevision,
  multiChannelScheduler
} = await import('../src/infrastructure/scheduler/broadcast-scheduler-engine.js');

await mediaStorage.ensureInitialized();

const usersRepo = RepositoryFactory.getUserRepository();
const stationsRepo = RepositoryFactory.getStationRepository();
const mediaRepo = RepositoryFactory.getMediaRepository();
const videoSourcesRepo = RepositoryFactory.getVideoSourceRepository();
const audioRepo = RepositoryFactory.getAudioRepository();

const adminUser = await usersRepo.create({
  email: 'scheduler-admin@pallcom.local',
  fullName: 'Broadcast Scheduler Director',
  passwordHash: 'unused',
  role: 'ORG_ADMIN',
  organizationId: 'org-sched-1'
});
const studioManagerUser = await usersRepo.create({
  email: 'scheduler-manager@pallcom.local',
  fullName: 'Broadcast Studio Manager',
  passwordHash: 'unused',
  role: 'STUDIO_MANAGER',
  organizationId: 'org-sched-1'
});
const operatorUser = await usersRepo.create({
  email: 'scheduler-operator@pallcom.local',
  fullName: 'Broadcast Scheduler Operator',
  passwordHash: 'unused',
  role: 'OPERATOR',
  organizationId: 'org-sched-1',
  permissions: JSON.stringify(['station:read', 'station:control', 'schedule:manage'])
});
const viewerUser = await usersRepo.create({
  email: 'scheduler-viewer@pallcom.local',
  fullName: 'Broadcast Scheduler Viewer',
  passwordHash: 'unused',
  role: 'VIEWER',
  organizationId: 'org-sched-1'
});
const foreignAdmin = await usersRepo.create({
  email: 'foreign-scheduler@pallcom.local',
  fullName: 'Foreign Scheduler Admin',
  passwordHash: 'unused',
  role: 'ORG_ADMIN',
  organizationId: 'org-sched-2'
});

function tokenFor(user) {
  const session = createSession(user.id);
  return CryptoService.signAccessToken({ sub: user.id, sid: session.id });
}

const adminToken = tokenFor(adminUser);
const managerToken = tokenFor(studioManagerUser);
const operatorToken = tokenFor(operatorUser);
const viewerToken = tokenFor(viewerUser);
const foreignToken = tokenFor(foreignAdmin);

const channelOne = await stationsRepo.create({
  name: 'Channel One — Live Camera & Music',
  organizationId: 'org-sched-1',
  encryptedPassword: 'unused',
  status: 'ONLINE',
  fps: 25
});
const channelTwo = await stationsRepo.create({
  name: 'Channel Two — Movies & Ads',
  organizationId: 'org-sched-1',
  encryptedPassword: 'unused',
  status: 'ONLINE',
  fps: 25
});
const foreignChannel = await stationsRepo.create({
  name: 'Foreign Channel',
  organizationId: 'org-sched-2',
  encryptedPassword: 'unused',
  status: 'ONLINE',
  fps: 25
});

async function seedTestAsset({
  organizationId = 'org-sched-1',
  title,
  category = 'MOVIES',
  kind = 'VIDEO',
  durationSeconds = 3600,
  processingStatus = 'READY',
  quarantined = false
}) {
  const id = randomUUID();
  const { storageKey } = await mediaStorage.storeBuffer(organizationId, id, 'mp4', Buffer.from(`media-${title}`));
  return mediaRepo.createAsset({
    id,
    organizationId,
    title,
    category,
    kind,
    originalFilename: `${title.replace(/\s+/g, '-').toLowerCase()}.mp4`,
    storageKey,
    sizeBytes: 4096,
    checksumSha256: randomBytes(32).toString('hex'),
    mimeType: kind === 'AUDIO' ? 'audio/wav' : (kind === 'IMAGE' ? 'image/png' : 'video/mp4'),
    containerFormat: kind === 'AUDIO' ? 'wav' : (kind === 'IMAGE' ? 'png' : 'mp4'),
    videoCodec: kind === 'VIDEO' ? 'h264' : null,
    audioCodec: kind === 'IMAGE' ? null : 'aac',
    width: kind === 'AUDIO' ? null : 1920,
    height: kind === 'AUDIO' ? null : 1080,
    frameRate: kind === 'VIDEO' ? 25 : null,
    durationSeconds,
    hasVideo: kind !== 'AUDIO',
    hasAudio: kind !== 'IMAGE',
    uploadStatus: 'UPLOADED',
    processingStatus,
    quarantined,
    broadcastCompatibility: 'DIRECT_PLAYBACK',
    createdByUserId: adminUser.id
  });
}

const movieAssetA = await seedTestAsset({ title: 'Feature Film Alpha 1080p', category: 'MOVIES', durationSeconds: 7200 });
const movieAssetB = await seedTestAsset({ title: 'Feature Film Beta 1080p', category: 'MOVIES', durationSeconds: 5400 });
const adAsset = await seedTestAsset({ title: 'Sponsor Spot 30s', category: 'ADVERTISEMENTS', durationSeconds: 30 });
const bumperAsset = await seedTestAsset({ title: 'Channel Ident 15s', category: 'STATION_IDENTS', durationSeconds: 15 });
const logoAsset = await seedTestAsset({ title: 'Station Watermark PNG', category: 'LOGOS', kind: 'IMAGE', durationSeconds: 0 });
const unreadyAsset = await seedTestAsset({ title: 'Unready Asset', category: 'MOVIES', processingStatus: 'VALIDATING' });
const foreignAsset = await seedTestAsset({ organizationId: 'org-sched-2', title: 'Foreign Movie', category: 'MOVIES' });

const camSource1 = await videoSourcesRepo.createSource({
  organizationId: 'org-sched-1',
  stationId: channelOne.id,
  name: 'City Plaza Camera 1',
  sourceType: 'IP_CAMERA',
  streamUrl: 'rtsp://10.20.30.40:554/cam1',
  connectionStatus: 'ONLINE',
  availabilityStatus: 'AVAILABLE',
  width: 1920,
  height: 1080,
  frameRate: 25,
  videoCodec: 'h264',
  createdByUserId: adminUser.id
});
const camSource2 = await videoSourcesRepo.createSource({
  organizationId: 'org-sched-1',
  stationId: channelOne.id,
  name: 'Harbor View Camera 2',
  sourceType: 'IP_CAMERA',
  streamUrl: 'rtsp://10.20.30.41:554/cam2',
  connectionStatus: 'ONLINE',
  availabilityStatus: 'AVAILABLE',
  width: 1920,
  height: 1080,
  frameRate: 25,
  videoCodec: 'h264',
  createdByUserId: adminUser.id
});
const foreignVideoSource = await videoSourcesRepo.createSource({
  organizationId: 'org-sched-2',
  stationId: foreignChannel.id,
  name: 'Foreign Camera',
  sourceType: 'IP_CAMERA',
  streamUrl: 'rtsp://10.20.30.99:554/foreign',
  createdByUserId: foreignAdmin.id
});

const musicAudioSource = await audioRepo.createAudioSource({
  organizationId: 'org-sched-1',
  channelId: channelOne.id,
  name: 'Continuous Ambient Stream',
  sourceType: 'RADIO_STREAM_HTTP',
  streamUrl: 'https://radio.pallcom.invalid/ambient.aac',
  state: 'READY',
  volumeLinear: 0.9,
  priority: 60,
  createdByUserId: adminUser.id
});
const foreignAudioSource = await audioRepo.createAudioSource({
  organizationId: 'org-sched-2',
  channelId: foreignChannel.id,
  name: 'Foreign Audio',
  sourceType: 'RADIO_STREAM_HTTP',
  streamUrl: 'https://radio.pallcom.invalid/foreign.aac',
  state: 'READY',
  createdByUserId: foreignAdmin.id
});

server.listen(0, '127.0.0.1');
await once(server, 'listening');
const origin = `http://127.0.0.1:${server.address().port}`;

test.after(async () => {
  multiChannelScheduler.stopAll();
  await new Promise(resolve => server.close(resolve));
  getSqliteDatabase().close();
  try {
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {}
});

async function apiRequest(path, { method = 'GET', token = adminToken, body } = {}) {
  const headers = { Authorization: `Bearer ${token}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${origin}/api/v1${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });
  const contentType = res.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await res.json() : await res.text();
  return { status: res.status, headers: res.headers, payload };
}

test('Daylight Saving Time (DST) handling: rejects nonexistent spring-forward times and disambiguates fall-back times', () => {
  // 1. America/New_York spring-forward gap on 2026-03-08 (02:00 -> 03:00 local time does not exist)
  assert.throws(
    () => resolveLocalCivilTimeToUtcMs('2026-03-08T02:30:00', 'America/New_York'),
    err => err.code === 'DST_NONEXISTENT_TIME' && err.statusCode === 400
  );

  // 2. America/New_York fall-back overlap on 2026-11-01 (01:00 -> 01:59 occurs twice: EDT UTC-4 and EST UTC-5)
  assert.throws(
    () => resolveLocalCivilTimeToUtcMs('2026-11-01T01:30:00', 'America/New_York', 'REJECT'),
    err => err.code === 'DST_AMBIGUOUS_TIME' && err.statusCode === 400
  );

  const fallBackEarlierMs = resolveLocalCivilTimeToUtcMs('2026-11-01T01:30:00', 'America/New_York', 'EARLIER');
  const fallBackLaterMs = resolveLocalCivilTimeToUtcMs('2026-11-01T01:30:00', 'America/New_York', 'LATER');
  assert.ok(Number.isFinite(fallBackEarlierMs));
  assert.ok(Number.isFinite(fallBackLaterMs));
  // Earlier (EDT) and Later (EST) must differ by exactly 1 hour (3,600,000 ms)
  assert.equal(fallBackLaterMs - fallBackEarlierMs, 3600000);

  // 3. Asia/Hebron normal local time conversion
  const hebronUtcMs = resolveLocalCivilTimeToUtcMs('2026-11-28T20:00:00', 'Asia/Hebron');
  assert.equal(new Date(hebronUtcMs).toISOString(), '2026-11-28T18:00:00.000Z');
});

test('Recurrence expansion: daily, weekly, selected weekdays, date-specific exceptions, and cross-midnight events', () => {
  const events = [
    {
      id: 'daily-news-cross-midnight',
      trackType: 'MAIN_VIDEO',
      executionMode: 'HARD_START',
      title: 'Late Night Cinema Cross-Midnight',
      mediaAssetId: movieAssetA.id,
      localStartDateTime: '2026-11-28T23:30:00',
      durationMs: 3600000, // 1 hour -> crosses midnight into 00:30 local
      recurrence: {
        frequency: 'DAILY',
        count: 4,
        exceptionDates: ['2026-11-29']
      }
    },
    {
      id: 'weekday-selected-ad',
      trackType: 'ADVERTISEMENTS',
      executionMode: 'FIXED_DURATION',
      title: 'Selected Weekday Sponsor',
      mediaAssetId: adAsset.id,
      localStartDateTime: '2026-11-28T12:00:00',
      durationMs: 30000,
      recurrence: {
        frequency: 'SELECTED_WEEKDAYS',
        weekdays: [6, 1], // Saturday & Monday
        count: 5
      }
    }
  ];

  const occurrences = expandScheduleOccurrences(events, {
    timezone: 'Asia/Hebron',
    windowStartMs: Date.parse('2026-11-28T00:00:00.000Z'),
    windowEndMs: Date.parse('2026-12-03T00:00:00.000Z')
  });

  const dailyOccurrences = occurrences.filter(o => o.id === 'daily-news-cross-midnight');
  // 4 days minus 1 exception date (2026-11-29) = 3 occurrences
  assert.equal(dailyOccurrences.length, 3);
  assert.ok(!dailyOccurrences.some(o => o.localDate === '2026-11-29'));

  const weekdayOccurrences = occurrences.filter(o => o.id === 'weekday-selected-ad');
  // Between Sat Nov 28 and Wed Dec 2: Sat Nov 28 and Mon Nov 30 match
  assert.equal(weekdayOccurrences.length, 2);
});

test('Schedule validation: detects conflicts, gaps, invalid durations, circular dependencies, DST errors, and unauthorized references while allowing compatible multi-track overlaps', async () => {
  // 1. Validate structural, DST, reference, and circular dependency errors
  const badEvents = [
    {
      id: 'evt-dst-bad',
      trackType: 'NEWS_TICKER',
      executionMode: 'FIXED_DURATION',
      title: 'Bad DST Ticker',
      localStartDateTime: '2026-03-08T02:15:00',
      durationMs: 60000
    },
    {
      id: 'evt-unready',
      trackType: 'ADVERTISEMENTS',
      executionMode: 'FIXED_DURATION',
      title: 'Unready Ad',
      mediaAssetId: unreadyAsset.id,
      startUtc: '2026-11-28T20:00:00.000Z',
      durationMs: 30000
    },
    {
      id: 'evt-foreign-asset',
      trackType: 'ADVERTISEMENTS',
      executionMode: 'FIXED_DURATION',
      title: 'Foreign Ad',
      mediaAssetId: foreignAsset.id,
      startUtc: '2026-11-28T20:05:00.000Z',
      durationMs: 30000
    },
    {
      id: 'evt-foreign-source',
      trackType: 'LIVE_CAMERA_ROTATION',
      executionMode: 'HARD_START',
      title: 'Foreign Camera Block',
      videoSourceId: foreignVideoSource.id,
      startUtc: '2026-11-28T21:00:00.000Z',
      durationMs: 600000
    },
    {
      id: 'evt-cross-channel-audio',
      trackType: 'INDEPENDENT_AUDIO',
      executionMode: 'HARD_START',
      title: 'Cross Channel Audio',
      audioSourceId: musicAudioSource.id, // belongs to channelOne, not channelTwo
      startUtc: '2026-11-28T21:00:00.000Z',
      durationMs: 600000
    },
    {
      id: 'evt-circ-a',
      trackType: 'MAIN_VIDEO',
      executionMode: 'FOLLOW_PREVIOUS',
      title: 'Circular A',
      mediaAssetId: bumperAsset.id,
      afterEventId: 'evt-circ-b',
      durationMs: 15000
    },
    {
      id: 'evt-circ-b',
      trackType: 'MAIN_VIDEO',
      executionMode: 'FOLLOW_PREVIOUS',
      title: 'Circular B',
      mediaAssetId: bumperAsset.id,
      afterEventId: 'evt-circ-a',
      durationMs: 15000
    }
  ];

  const badValidation = await validateScheduleRevision({
    organizationId: 'org-sched-1',
    channelId: channelTwo.id,
    timezone: 'America/New_York',
    events: badEvents,
    windowStartMs: Date.parse('2026-11-28T17:00:00.000Z'),
    windowEndMs: Date.parse('2026-11-28T23:00:00.000Z')
  });

  assert.equal(badValidation.valid, false);
  const errorCodes = badValidation.errors.map(e => e.code);
  assert.ok(errorCodes.includes('DST_NONEXISTENT_TIME'));
  assert.ok(errorCodes.includes('UNREADY_MEDIA_ASSET'));
  assert.ok(errorCodes.includes('MISSING_OR_FOREIGN_MEDIA_ASSET'));
  assert.ok(errorCodes.includes('MISSING_OR_FOREIGN_VIDEO_SOURCE'));
  assert.ok(errorCodes.includes('CROSS_CHANNEL_AUDIO_SOURCE'));
  assert.ok(errorCodes.includes('CIRCULAR_EVENT_DEPENDENCY'));

  // 2. Validate overlapping HARD_START conflict and primary video gap detection when structural references are valid
  const overlapAndGapValidation = await validateScheduleRevision({
    organizationId: 'org-sched-1',
    channelId: channelTwo.id,
    timezone: 'UTC',
    events: [
      {
        id: 'evt-hard-1',
        trackType: 'MAIN_VIDEO',
        executionMode: 'HARD_START',
        title: 'Hard Start Movie 1',
        mediaAssetId: movieAssetA.id,
        startUtc: '2026-11-28T18:00:00.000Z',
        durationMs: 3600000
      },
      {
        id: 'evt-hard-2',
        trackType: 'MAIN_VIDEO',
        executionMode: 'HARD_START',
        title: 'Conflicting Hard Start Movie 2',
        mediaAssetId: movieAssetB.id,
        startUtc: '2026-11-28T18:30:00.000Z',
        durationMs: 3600000
      },
      {
        id: 'evt-after-gap',
        trackType: 'MAIN_VIDEO',
        executionMode: 'HARD_START',
        title: 'Movie After 30m Gap',
        mediaAssetId: movieAssetA.id,
        startUtc: '2026-11-28T20:00:00.000Z',
        durationMs: 3600000
      },
      // Compatible overlap on GRAPHICS_OVERLAYS -> allowed without error
      {
        id: 'evt-overlay-ok',
        trackType: 'GRAPHICS_OVERLAYS',
        executionMode: 'FIXED_DURATION',
        title: 'Compatible Watermark Overlay',
        mediaAssetId: logoAsset.id,
        startUtc: '2026-11-28T18:00:00.000Z',
        durationMs: 1800000
      }
    ],
    windowStartMs: Date.parse('2026-11-28T18:00:00.000Z'),
    windowEndMs: Date.parse('2026-11-28T22:00:00.000Z')
  });

  assert.equal(overlapAndGapValidation.valid, false);
  assert.ok(overlapAndGapValidation.errors.some(e => e.code === 'CONFLICTING_HARD_STARTS'));
  assert.equal(overlapAndGapValidation.gaps.length, 1);
  assert.equal(overlapAndGapValidation.gaps[0].startUtc, '2026-11-28T19:30:00.000Z');
  assert.equal(overlapAndGapValidation.gaps[0].endUtc, '2026-11-28T20:00:00.000Z');
  assert.equal(overlapAndGapValidation.gaps[0].durationMs, 1800000);
});

test('RBAC, tenant isolation, draft vs published workflow, optimistic concurrency locking, and media deletion protection', async () => {
  // 1. Viewer can read schedule state (`station:read`) but cannot save draft (`schedule:manage`),
  //    and Operator without `schedule:manage` cannot save draft either (`403`)
  const viewerRead = await apiRequest(`/channels/${channelOne.id}/scheduler`, { token: viewerToken });
  assert.equal(viewerRead.status, 200);

  const viewerSaveDraft = await apiRequest(`/channels/${channelOne.id}/scheduler/draft`, {
    method: 'PUT',
    token: viewerToken,
    body: { name: 'Unauthorized Viewer Draft', events: [] }
  });
  assert.equal(viewerSaveDraft.status, 403);

  const operatorSaveDraft = await apiRequest(`/channels/${channelOne.id}/scheduler/draft`, {
    method: 'PUT',
    token: operatorToken,
    body: { name: 'Unauthorized Operator Draft', events: [] }
  });
  assert.equal(operatorSaveDraft.status, 403);

  // 2. Foreign admin cannot read or modify another organization's channel schedule
  const foreignRead = await apiRequest(`/channels/${channelOne.id}/scheduler`, { token: foreignToken });
  assert.equal(foreignRead.status, 404);

  // 3. Studio Manager with `schedule:manage` saves a valid multi-track draft covering all 7 tracks
  const baseTimeMs = Date.parse('2026-11-28T12:00:00.000Z');
  const draftRes = await apiRequest(`/channels/${channelOne.id}/scheduler/draft`, {
    method: 'PUT',
    token: managerToken,
    body: {
      name: 'Channel One 7-Track Schedule v1',
      timezone: 'Asia/Hebron',
      activationPolicy: 'APPLY_NEXT_BOUNDARY',
      gapPolicy: 'FALLBACK_CAMERA',
      gapFallbackSourceId: camSource1.id,
      events: [
        {
          id: 'c1-cam-rot-1',
          trackType: 'LIVE_CAMERA_ROTATION',
          executionMode: 'HARD_START',
          title: 'Afternoon City Camera Rotation',
          videoSourceId: camSource1.id,
          startUtc: new Date(baseTimeMs).toISOString(),
          durationMs: 1800000,
          metadata: {
            cameraSequence: [
              { sourceId: camSource1.id, durationSeconds: 20, priority: 80, enabled: true },
              { sourceId: camSource2.id, durationSeconds: 20, priority: 70, enabled: true }
            ]
          }
        },
        {
          id: 'c1-follow-movie',
          trackType: 'MAIN_VIDEO',
          executionMode: 'HARD_START',
          title: 'Documentary Feature after Cameras',
          mediaAssetId: movieAssetA.id,
          startUtc: new Date(baseTimeMs + 1800000).toISOString(),
          durationMs: 1800000
        },
        {
          id: 'c1-ind-audio-1',
          trackType: 'INDEPENDENT_AUDIO',
          executionMode: 'HARD_START',
          title: 'Continuous Ambient Radio Stream',
          audioSourceId: musicAudioSource.id,
          startUtc: new Date(baseTimeMs).toISOString(),
          durationMs: 3600000,
          metadata: {
            routingMode: 'SILENT_VIDEO_WITH_INDEPENDENT_AUDIO',
            volumeLinear: 0.85,
            gainDb: -1.5
          }
        },
        {
          id: 'c1-ad-spot-1',
          trackType: 'ADVERTISEMENTS',
          executionMode: 'FIXED_DURATION',
          title: 'Mid-Hour Sponsor Ad',
          mediaAssetId: adAsset.id,
          startUtc: new Date(baseTimeMs + 900000).toISOString(),
          durationMs: 30000
        },
        {
          id: 'c1-gfx-1',
          trackType: 'GRAPHICS_OVERLAYS',
          executionMode: 'FIXED_DURATION',
          title: 'Station Brand Watermark',
          mediaAssetId: logoAsset.id,
          startUtc: new Date(baseTimeMs).toISOString(),
          durationMs: 3600000,
          metadata: { enabled: true }
        },
        {
          id: 'c1-ticker-1',
          trackType: 'NEWS_TICKER',
          executionMode: 'FIXED_DURATION',
          title: 'Hourly NewsCrawl',
          startUtc: new Date(baseTimeMs).toISOString(),
          durationMs: 3600000,
          metadata: { tickerText: 'PALLCOM MCR LIVE BROADCAST SCHEDULER VERIFICATION', enabled: true }
        },
        {
          id: 'c1-auto-1',
          trackType: 'AUTOMATION_CONTROL',
          executionMode: 'HARD_START',
          title: 'Switch Audio Ducking Policy',
          startUtc: new Date(baseTimeMs + 600000).toISOString(),
          durationMs: 5000,
          metadata: { action: 'SET_AUDIO_ROUTING', routingMode: 'SILENT_VIDEO_WITH_INDEPENDENT_AUDIO' }
        }
      ]
    }
  });
  assert.equal(draftRes.status, 200);
  const draftRevision = draftRes.payload.data;
  assert.equal(draftRevision.lifecycleState, 'DRAFT');

  // 4. Optimistic concurrency check: saving with stale expectedRevisionNumber returns 409
  const staleSave = await apiRequest(`/channels/${channelOne.id}/scheduler/draft`, {
    method: 'PUT',
    token: managerToken,
    body: {
      expectedRevisionNumber: 999,
      name: 'Stale Write Attempt'
    }
  });
  assert.equal(staleSave.status, 409);

  // 5. Publish the validated revision (`schedule:publish`)
  const publishRes = await apiRequest(`/channels/${channelOne.id}/scheduler/publish`, {
    method: 'POST',
    token: adminToken,
    body: {
      revisionId: draftRevision.id,
      expectedRevisionNumber: draftRevision.revisionNumber,
      activationPolicy: 'APPLY_IMMEDIATELY_SAFE'
    }
  });
  assert.equal(publishRes.status, 200);
  const publishedRevision = publishRes.payload.data.published;
  assert.equal(publishedRevision.lifecycleState, 'PUBLISHED');

  // 6. Media asset referenced by published schedule cannot be deleted (`SCHEDULED_PLAYBACK`)
  const deleteScheduledAsset = await apiRequest(`/media/assets/${movieAssetA.id}?confirm=true`, {
    method: 'DELETE',
    token: adminToken
  });
  assert.equal(deleteScheduledAsset.status, 409);
  assert.ok(JSON.stringify(deleteScheduledAsset.payload).includes('SCHEDULED_PLAYBACK'));

  // 7. Modifying a new draft does NOT alter the active published revision
  const newDraftRes = await apiRequest(`/channels/${channelOne.id}/scheduler/draft`, {
    method: 'PUT',
    token: managerToken,
    body: {
      name: 'Channel One Draft v2 (Unpublished Edit)',
      events: publishedRevision.events.slice(0, 2)
    }
  });
  assert.equal(newDraftRes.status, 200);
  assert.notEqual(newDraftRes.payload.data.id, publishedRevision.id);

  const checkOverview = await apiRequest(`/channels/${channelOne.id}/scheduler`);
  assert.equal(checkOverview.payload.data.published.id, publishedRevision.id);
  assert.equal(checkOverview.payload.data.published.events.length, 7);
  assert.equal(checkOverview.payload.data.draft.events.length, 2);

  // 8. EPG guide endpoint returns structured program guide entries
  const epgRes = await apiRequest(
    `/channels/${channelOne.id}/scheduler/epg?windowStartUtc=${encodeURIComponent(new Date(baseTimeMs).toISOString())}&windowEndUtc=${encodeURIComponent(new Date(baseTimeMs + 7200000).toISOString())}`
  );
  assert.equal(epgRes.status, 200);
  assert.ok(epgRes.payload.data.programs.length >= 2);
});

test('72-Hour Continuous Multi-Track Schedule Validation, Deterministic Simulation, Mid-Movie Ad Interruption/Resume, Missed Events, and Emergency Overrides', async () => {
  // Build a 72-hour continuous schedule on Channel Two using recurring daily 4-hour movie blocks
  // (6 blocks/day * 4 hours = 24 hours/day * 3 days = 72 hours) plus a mid-movie advertisement
  // interruption, a soft-start item, and a manual/emergency override check.
  const windowStartMs = Date.parse('2026-12-01T00:00:00.000Z');
  const windowEndMs = windowStartMs + (72 * 3600000); // 72 hours = 259,200,000 ms

  const events = [];
  for (let blockIdx = 0; blockIdx < 6; blockIdx++) {
    const blockOffsetMs = blockIdx * 4 * 3600000;
    const firstDayBlockStartUtc = new Date(windowStartMs + blockOffsetMs).toISOString();
    events.push({
      id: `movie-block-${blockIdx}`,
      trackType: 'MAIN_VIDEO',
      executionMode: blockIdx === 1 ? 'SOFT_START' : 'HARD_START',
      title: `72h Cinema Block ${blockIdx + 1}`,
      mediaAssetId: blockIdx % 2 === 0 ? movieAssetA.id : movieAssetB.id,
      startUtc: firstDayBlockStartUtc,
      durationMs: 4 * 3600000, // 4 hours per block
      priority: 60,
      allowPreemption: true,
      recurrence: {
        frequency: 'DAILY',
        count: 3 // 3 days = 72 hours
      }
    });
  }

  // Add a mid-movie advertisement interruption 30 minutes into Block 0 on Day 1
  const adStartMs = windowStartMs + (30 * 60000); // +1,800,000 ms (30 minutes into movie-block-0)
  events.push({
    id: 'mid-movie-ad-break-1',
    trackType: 'ADVERTISEMENTS',
    executionMode: 'FIXED_DURATION',
    title: 'Mid-Movie Commercial Break 30s',
    mediaAssetId: adAsset.id,
    startUtc: new Date(adStartMs).toISOString(),
    durationMs: 30000,
    priority: 90
  });

  // Add an already-expired event before windowStartMs to verify missed-event reconciliation
  const expiredEventStartMs = windowStartMs - 1800000; // 30 minutes before start, duration 60s
  events.push({
    id: 'expired-past-bumper',
    trackType: 'ADVERTISEMENTS',
    executionMode: 'FIXED_DURATION',
    title: 'Expired Past Bumper',
    mediaAssetId: bumperAsset.id,
    startUtc: new Date(expiredEventStartMs).toISOString(),
    durationMs: 60000
  });

  // 1. Save and validate across the full 72-hour window
  const saveRes = await apiRequest(`/channels/${channelTwo.id}/scheduler/draft`, {
    method: 'PUT',
    body: {
      name: 'Channel Two 72-Hour Continuous Schedule',
      timezone: 'UTC',
      activationPolicy: 'APPLY_IMMEDIATELY_SAFE',
      gapPolicy: 'CHANNEL_IDENT_CLIP',
      gapFallbackAssetId: bumperAsset.id,
      events
    }
  });
  assert.equal(saveRes.status, 200);

  const validate72hRes = await apiRequest(`/channels/${channelTwo.id}/scheduler/validate`, {
    method: 'POST',
    body: {
      windowStartUtc: new Date(windowStartMs - 3600000).toISOString(),
      windowEndUtc: new Date(windowEndMs).toISOString()
    }
  });
  assert.equal(validate72hRes.status, 200);
  const validationSummary = validate72hRes.payload.data.validation;
  assert.equal(validationSummary.valid, true);
  // 6 blocks/day * 3 days = 18 movie blocks + 1 ad + 1 expired bumper = 20 occurrences
  assert.equal(validationSummary.occurrenceCount, 20);
  assert.equal(validationSummary.gaps.length, 0);

  // 2. Publish the 72-hour schedule
  const publishRes = await apiRequest(`/channels/${channelTwo.id}/scheduler/publish`, {
    method: 'POST',
    body: {
      revisionId: saveRes.payload.data.id,
      activationPolicy: 'APPLY_IMMEDIATELY_SAFE'
    }
  });
  assert.equal(publishRes.status, 200);

  // 3. Step the deterministic scheduler at windowStartMs:
  //    - 'expired-past-bumper' is marked MISSED in As-Run without playing late
  //    - 'movie-block-0' starts on MAIN_VIDEO
  const stepStartRes = await apiRequest(`/channels/${channelTwo.id}/scheduler/step`, {
    method: 'POST',
    body: { nowUtc: new Date(windowStartMs + 100).toISOString() }
  });
  assert.equal(stepStartRes.status, 200);
  assert.equal(stepStartRes.payload.data.executionState.currentTrackStates.MAIN_VIDEO.eventId, 'movie-block-0');

  // 4. Step again at the same timestamp to verify idempotency / duplicate execution prevention
  const stepDupRes = await apiRequest(`/channels/${channelTwo.id}/scheduler/step`, {
    method: 'POST',
    body: { nowUtc: new Date(windowStartMs + 500).toISOString() }
  });
  assert.equal(stepDupRes.status, 200);

  // 5. Step at adStartMs (+30 minutes into movie):
  //    - 'mid-movie-ad-break-1' starts on ADVERTISEMENTS
  //    - Movie playback is interrupted and interruptedProgramState stores resumeOffsetMs (~1,800,100 ms)
  const stepAdStart = await apiRequest(`/channels/${channelTwo.id}/scheduler/step`, {
    method: 'POST',
    body: { nowUtc: new Date(adStartMs + 200).toISOString() }
  });
  assert.equal(stepAdStart.status, 200);
  assert.equal(stepAdStart.payload.data.executionState.currentTrackStates.ADVERTISEMENTS.eventId, 'mid-movie-ad-break-1');
  assert.ok(stepAdStart.payload.data.executionState.interruptedProgramState?.occurrenceId);
  assert.ok(stepAdStart.payload.data.executionState.interruptedProgramState.resumeOffsetMs >= 1800000);

  // 6. Step after ad completion (adStartMs + 31,000 ms):
  //    - Ad finishes (`COMPLETED`)
  //    - Movie resumes (`MOVIE_RESUME`) at the stored resumeOffsetMs and interruptedProgramState is cleared
  const stepAdEnd = await apiRequest(`/channels/${channelTwo.id}/scheduler/step`, {
    method: 'POST',
    body: { nowUtc: new Date(adStartMs + 31000).toISOString() }
  });
  assert.equal(stepAdEnd.status, 200);
  assert.equal(stepAdEnd.payload.data.executionState.currentTrackStates.ADVERTISEMENTS, undefined);
  assert.equal(stepAdEnd.payload.data.executionState.interruptedProgramState.occurrenceId, undefined);
  assert.ok(stepAdEnd.payload.data.executionState.currentTrackStates.MAIN_VIDEO.resumeOffsetMs >= 1800000);

  // 7. Step across key boundaries up to the 72-hour mark
  for (const hour of [4, 8, 24, 48, 68]) {
    const stepHour = await apiRequest(`/channels/${channelTwo.id}/scheduler/step`, {
      method: 'POST',
      body: { nowUtc: new Date(windowStartMs + (hour * 3600000) + 1000).toISOString() }
    });
    assert.equal(stepHour.status, 200);
    assert.ok(stepHour.payload.data.executionState.currentTrackStates.MAIN_VIDEO);
  }

  // 8. Verify viewer cannot trigger EMERGENCY_OVERRIDE (`403`)
  const viewerEmergency = await apiRequest(`/channels/${channelTwo.id}/scheduler/control`, {
    method: 'POST',
    token: viewerToken,
    body: {
      action: 'EMERGENCY_OVERRIDE',
      overrideSourceId: bumperAsset.id
    }
  });
  assert.equal(viewerEmergency.status, 403);

  // 9. Admin with `broadcast:emergency` triggers EMERGENCY_OVERRIDE and then clears it
  const adminEmergency = await apiRequest(`/channels/${channelTwo.id}/scheduler/control`, {
    method: 'POST',
    token: adminToken,
    body: {
      action: 'EMERGENCY_OVERRIDE',
      overrideSourceId: bumperAsset.id
    }
  });
  assert.equal(adminEmergency.status, 200);
  assert.equal(adminEmergency.payload.data.emergencyOverrideActive, true);

  const clearEmergency = await apiRequest(`/channels/${channelTwo.id}/scheduler/control`, {
    method: 'POST',
    token: adminToken,
    body: { action: 'CLEAR_EMERGENCY' }
  });
  assert.equal(clearEmergency.status, 200);
  assert.equal(clearEmergency.payload.data.emergencyOverrideActive, false);

  // 10. Verify As-Run logs and CSV export contain MISSED, COMPLETED, INTERRUPTED_BY_AD, and MOVIE_RESUME
  const asRunRes = await apiRequest(`/channels/${channelTwo.id}/scheduler/as-run?limit=100`);
  assert.equal(asRunRes.status, 200);
  const logs = asRunRes.payload.data;
  assert.ok(logs.some(l => l.eventId === 'expired-past-bumper' && l.status === 'MISSED'));
  assert.ok(logs.some(l => l.eventId === 'mid-movie-ad-break-1' && l.status === 'COMPLETED'));
  assert.ok(logs.some(l => l.status === 'INTERRUPTED_BY_AD'));
  assert.ok(logs.some(l => l.category === 'MOVIE_RESUME' && l.resumeOffsetMs >= 1800000));

  const csvExportRes = await apiRequest(`/channels/${channelTwo.id}/scheduler/as-run?format=csv`);
  assert.equal(csvExportRes.status, 200);
  assert.ok(String(csvExportRes.payload).includes('INTERRUPTED_BY_AD'));
});
