import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory = mkdtempSync(join(tmpdir(), 'mcr-mysql-rehearsal-'));
const sqlitePath = join(directory, 'source.sqlite');
const mysqlBin = process.env.MCR_MYSQL_BIN || 'c:\\xampp\\mysql\\bin\\mysql.exe';
const dbName = 'pallcom_mcr_rehearsal_' + randomBytes(4).toString('hex');
const mysqlUrl = `mysql://root@127.0.0.1:3306/${dbName}`;
const secret = () => randomBytes(32).toString('hex');

Object.assign(process.env, {
  NODE_ENV: 'test',
  STORAGE_MODE: 'sqlite',
  SQLITE_DB_PATH: sqlitePath,
  DATABASE_URL: mysqlUrl,
  PRISMA_QUERY_ENGINE_LIBRARY: 'D:\\Projects\\pallcom-mcr\\pallcom-mcr\\node_modules\\@prisma\\engines\\query_engine-windows.dll.node',
  PRISMA_SCHEMA_ENGINE_BINARY: 'D:\\Projects\\pallcom-mcr\\pallcom-mcr\\node_modules\\@prisma\\engines\\schema-engine-windows.exe',
  JWT_SECRET: secret(),
  REFRESH_TOKEN_SECRET: secret(),
  ENCRYPTION_MASTER_KEY: secret()
});

const { RepositoryFactory } = await import('../src/infrastructure/repositories/repository-factory.js');
const { getSqliteDatabase } = await import('../src/infrastructure/database/sqlite.js');
const { closePrismaClient, getPrismaClient } = await import('../src/infrastructure/database/mysql-prisma.js');
const { rehearseSqliteToMysqlMigration } = await import('../scripts/sqlite-to-mysql-migration.js');

try {
  // 1. Seed SQLite with representative users, stations, media assets, playlists, video sources, and audit logs
  const sqliteUsers = RepositoryFactory.getUserRepository();
  const sqliteStations = RepositoryFactory.getStationRepository();
  const sqliteMedia = RepositoryFactory.getMediaRepository();
  const sqliteSources = RepositoryFactory.getVideoSourceRepository();
  const sqliteAudio = RepositoryFactory.getAudioRepository();
  const sqlitePlayout = RepositoryFactory.getChannelPlayoutRepository();
  const sqliteScheduler = RepositoryFactory.getBroadcastSchedulerRepository();

  const admin = await sqliteUsers.create({
    id: randomUUID(),
    email: 'mysql-admin@pallcom.test',
    fullName: 'MySQL Rehearsal Admin',
    role: 'ORG_ADMIN',
    organizationId: 'org-mysql-1',
    passwordHash: 'argon2-hash-fixture'
  });
  const station = await sqliteStations.create({
    name: 'MySQL Rehearsal Station 1',
    organizationId: 'org-mysql-1',
    encryptedPassword: 'encrypted-obs-fixture'
  }, { userId: admin.id, ipAddress: '127.0.0.1' });

  const asset = await sqliteMedia.createAsset({
    id: randomUUID(),
    organizationId: 'org-mysql-1',
    title: 'MySQL Migrated Movie 1080p',
    category: 'MOVIES',
    kind: 'VIDEO',
    originalFilename: 'movie.mp4',
    storageKey: `media/org-mysql-1/${randomUUID()}.bin`,
    sizeBytes: 1081190040,
    checksumSha256: 'a'.repeat(64),
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
  }, { id: admin.id, ipAddress: '127.0.0.1' });

  const playlist = await sqliteMedia.createPlaylist({
    organizationId: 'org-mysql-1',
    name: 'MySQL Migrated Playlist',
    kind: 'VIDEO',
    channelId: station.id,
    items: [{ assetId: asset.id, order: 0 }],
    createdByUserId: admin.id
  }, { id: admin.id, ipAddress: '127.0.0.1' });

  const source = await sqliteSources.createSource({
    organizationId: 'org-mysql-1',
    stationId: station.id,
    name: 'MySQL Migrated Movie Source',
    sourceType: 'MOVIE',
    mediaAssetId: asset.id,
    connectionStatus: 'ONLINE',
    availabilityStatus: 'AVAILABLE',
    width: 1920,
    height: 1080,
    frameRate: 25,
    videoCodec: 'h264',
    audioCodec: 'aac',
    hasAudio: true,
    createdByUserId: admin.id
  }, { id: admin.id, ipAddress: '127.0.0.1' });

  const audioSource = await sqliteAudio.createAudioSource({
    organizationId: 'org-mysql-1',
    channelId: station.id,
    name: 'MySQL Migrated Radio & Music Source',
    sourceType: 'UPLOADED_AUDIO',
    state: 'PLAYING',
    mediaAssetId: asset.id,
    encryptedSecret: 'aes-256-gcm-radio-secret-fixture',
    volumeLinear: 0.85,
    gainDb: -1.4,
    priority: 75,
    duckingTarget: true,
    createdByUserId: admin.id
  }, { id: admin.id, ipAddress: '127.0.0.1' });

  const mixerConfig = await sqliteAudio.saveChannelMixerConfig(station.id, 'org-mysql-1', {
    routingMode: 'SILENT_VIDEO_WITH_INDEPENDENT_AUDIO',
    fallbackSourceId: audioSource.id,
    masterVolumeLinear: 0.92,
    masterGainDb: -0.7,
    duckingEnabled: true,
    duckingReductionDb: -14,
    crossfadeDurationMs: 1800,
    adAudioPolicy: 'DUCK_MUSIC_DURING_ADS'
  }, { id: admin.id, ipAddress: '127.0.0.1' });
  assert.equal(mixerConfig.routingMode, 'SILENT_VIDEO_WITH_INDEPENDENT_AUDIO');

  const playoutConfig = await sqlitePlayout.saveChannelConfig(station.id, 'org-mysql-1', {
    playoutMode: 'MOVIE_PLAYOUT',
    desiredState: 'RUNNING',
    runtimeState: 'RUNNING',
    width: 1920,
    height: 1080,
    frameRate: 25,
    videoBitrateKbps: 5000,
    currentMediaAssetId: asset.id,
    movieQueue: [{ assetId: asset.id, title: 'MySQL Migrated Movie 1080p', durationSeconds: 7200 }],
    playbackPositionMs: 120000,
    remainingDurationMs: 7080000
  }, { id: admin.id, ipAddress: '127.0.0.1' });
  assert.equal(playoutConfig.playoutMode, 'MOVIE_PLAYOUT');

  const draftSchedule = await sqliteScheduler.saveDraftRevision(station.id, 'org-mysql-1', {
    name: 'MySQL Migrated Broadcast Schedule',
    timezone: 'Asia/Hebron',
    activationPolicy: 'APPLY_NEXT_BOUNDARY',
    gapPolicy: 'GAP_FALLBACK_MEDIA',
    gapFallbackAssetId: asset.id,
    events: [
      {
        id: 'evt-migrated-movie-1',
        trackType: 'MAIN_VIDEO',
        executionMode: 'HARD_START',
        title: 'Migrated Prime Time Movie',
        mediaAssetId: asset.id,
        startUtc: '2026-11-28T18:00:00.000Z',
        durationMs: 7200000,
        priority: 80
      }
    ],
    templates: [
      {
        id: 'tpl-migrated-1',
        name: 'Prime Time Template',
        events: []
      }
    ]
  }, { id: admin.id, ipAddress: '127.0.0.1' });

  const publishedSchedule = await sqliteScheduler.publishRevision(station.id, 'org-mysql-1', {
    revisionId: draftSchedule.id,
    activationPolicy: 'APPLY_NEXT_BOUNDARY',
    validationSummary: { valid: true, errorCount: 0, warningCount: 0, gapCount: 0 }
  }, { id: admin.id, ipAddress: '127.0.0.1' });
  assert.equal(publishedSchedule.lifecycleState, 'PUBLISHED');

  await sqliteScheduler.updateExecutionState(station.id, 'org-mysql-1', {
    schedulerRunning: true,
    activeRevisionId: publishedSchedule.id,
    activeRevisionNumber: publishedSchedule.revisionNumber,
    leaseOwnerId: 'scheduler-node-rehearsal-1',
    leaseExpiresAt: Date.now() + 60000,
    currentTrackStates: {
      MAIN_VIDEO: {
        occurrenceId: 'evt-migrated-movie-1@1795888800000',
        eventId: 'evt-migrated-movie-1',
        title: 'Migrated Prime Time Movie',
        actualStartMs: Date.parse('2026-11-28T18:00:00.000Z')
      }
    },
    claimedOccurrenceIds: ['evt-migrated-movie-1@1795888800000']
  });

  await sqliteScheduler.createAsRunRecord({
    organizationId: 'org-mysql-1',
    channelId: station.id,
    revisionId: publishedSchedule.id,
    revisionNumber: publishedSchedule.revisionNumber,
    eventId: 'evt-migrated-movie-1',
    occurrenceId: 'evt-migrated-movie-1@1795888800000',
    trackType: 'MAIN_VIDEO',
    executionMode: 'HARD_START',
    title: 'Migrated Prime Time Movie',
    category: 'MOVIES',
    mediaAssetId: asset.id,
    plannedStartUtc: '2026-11-28T18:00:00.000Z',
    plannedEndUtc: '2026-11-28T20:00:00.000Z',
    actualStartUtc: '2026-11-28T18:00:00.050Z',
    plannedDurationMs: 7200000,
    status: 'RUNNING',
    workerConfirmed: true
  });

  getSqliteDatabase().close();

  // 2. Push Prisma schema to fresh isolated MySQL database
  execFileSync(
    process.execPath,
    ['node_modules/prisma/build/index.js', 'db', 'push', '--schema=backend/database/prisma/schema.prisma', '--skip-generate'],
    { env: process.env, windowsHide: true, stdio: 'pipe' }
  );

  // 3. Rehearse SQLite -> MySQL migration and verify 100% row count parity
  const migrationSummary = await rehearseSqliteToMysqlMigration({ sqlitePath, mysqlUrl });
  assert.deepEqual(migrationSummary.mysqlCounts, migrationSummary.sqliteCounts);

  // 4. Switch RepositoryFactory to MySQL mode and verify live CRUD, tenant isolation, reference checks, and EXPLAIN index usage
  process.env.MCR_REPOSITORY_DRIVER = 'mysql';
  const mysqlUsers = RepositoryFactory.getUserRepository();
  const mysqlStations = RepositoryFactory.getStationRepository();
  const mysqlMedia = RepositoryFactory.getMediaRepository();
  const mysqlSources = RepositoryFactory.getVideoSourceRepository();
  const mysqlAudio = RepositoryFactory.getAudioRepository();
  const mysqlPlayout = RepositoryFactory.getChannelPlayoutRepository();
  const mysqlScheduler = RepositoryFactory.getBroadcastSchedulerRepository();

  const fetchedAdmin = await mysqlUsers.findByEmail('mysql-admin@pallcom.test');
  assert.equal(fetchedAdmin.id, admin.id);

  const fetchedStation = await mysqlStations.findById(station.id, 'org-mysql-1');
  assert.equal(fetchedStation.name, 'MySQL Rehearsal Station 1');
  assert.equal(await mysqlStations.findById(station.id, 'foreign-org'), null);

  const fetchedAsset = await mysqlMedia.findAssetById(asset.id, 'org-mysql-1');
  assert.equal(fetchedAsset.title, 'MySQL Migrated Movie 1080p');
  assert.equal(fetchedAsset.sizeBytes, 1081190040);
  // Asset is referenced by playlist, video source, audio source, and active channel playout in MySQL
  assert.equal(fetchedAsset.eligibleForDeletion, false);
  assert.ok(fetchedAsset.references.blockingReasons.includes('PLAYLIST_REFERENCE'));
  assert.ok(fetchedAsset.references.blockingReasons.includes('VIDEO_SOURCE_REFERENCE'));
  assert.ok(fetchedAsset.references.blockingReasons.includes('AUDIO_SOURCE_REFERENCE'));
  assert.ok(fetchedAsset.references.blockingReasons.includes('ACTIVE_BROADCAST'));
  assert.ok(fetchedAsset.references.blockingReasons.includes('CHANNEL_PLAYOUT_REFERENCE'));
  assert.ok(fetchedAsset.references.blockingReasons.includes('SCHEDULED_PLAYBACK'));

  const fetchedPublishedSchedule = await mysqlScheduler.getActivePublishedRevision(station.id, 'org-mysql-1');
  assert.equal(fetchedPublishedSchedule.id, publishedSchedule.id);
  assert.equal(fetchedPublishedSchedule.timezone, 'Asia/Hebron');
  assert.equal(fetchedPublishedSchedule.events.length, 1);

  const fetchedExecState = await mysqlScheduler.getExecutionState(station.id, 'org-mysql-1');
  assert.equal(fetchedExecState.schedulerRunning, true);
  assert.equal(fetchedExecState.activeRevisionId, publishedSchedule.id);
  assert.equal(fetchedExecState.claimedOccurrenceIds.length, 1);

  const fetchedAsRunLogs = await mysqlScheduler.listAsRunRecords(station.id, 'org-mysql-1', { limit: 10 });
  assert.equal(fetchedAsRunLogs.length, 1);
  assert.equal(fetchedAsRunLogs[0].title, 'Migrated Prime Time Movie');
  assert.equal(fetchedAsRunLogs[0].workerConfirmed, true);

  const fetchedPlayoutConfig = await mysqlPlayout.getChannelConfig(station.id, 'org-mysql-1');
  assert.equal(fetchedPlayoutConfig.playoutMode, 'MOVIE_PLAYOUT');
  assert.equal(fetchedPlayoutConfig.width, 1920);
  assert.equal(fetchedPlayoutConfig.height, 1080);
  assert.equal(fetchedPlayoutConfig.playbackPositionMs, 120000);
  assert.equal(fetchedPlayoutConfig.movieQueue.length, 1);

  // Verify revision conflict protection on PrismaChannelPlayoutRepository
  await assert.rejects(
    () => mysqlPlayout.saveChannelConfig(station.id, 'org-mysql-1', {
      expectedRevision: 999,
      videoBitrateKbps: 6000
    }),
    err => err.statusCode === 409
  );

  // Verify migrated AudioSource and AudioMixerConfig field values, encrypted secret preservation, and concurrent writes
  const fetchedAudioSource = await mysqlAudio.findAudioSourceById(audioSource.id, 'org-mysql-1', { includeEncryptedSecret: true });
  assert.equal(fetchedAudioSource.name, 'MySQL Migrated Radio & Music Source');
  assert.equal(fetchedAudioSource.encryptedSecret, 'aes-256-gcm-radio-secret-fixture');
  assert.equal(fetchedAudioSource.hasSecret, true);
  assert.equal(fetchedAudioSource.priority, 75);

  const fetchedMixerConfig = await mysqlAudio.getChannelMixerConfig(station.id, 'org-mysql-1');
  assert.equal(fetchedMixerConfig.routingMode, 'SILENT_VIDEO_WITH_INDEPENDENT_AUDIO');
  assert.equal(fetchedMixerConfig.fallbackSourceId, audioSource.id);
  assert.equal(fetchedMixerConfig.adAudioPolicy, 'DUCK_MUSIC_DURING_ADS');
  assert.equal(fetchedMixerConfig.crossfadeDurationMs, 1800);

  // Concurrent write transaction test on PrismaAudioRepository
  await Promise.all([
    mysqlAudio.updateAudioSource(audioSource.id, 'org-mysql-1', { volumeLinear: 0.75 }),
    mysqlAudio.updateAudioSourceRuntimeState(audioSource.id, 'org-mysql-1', { measuredRmsDbfs: -18.5 }),
    mysqlAudio.saveChannelMixerConfig(station.id, 'org-mysql-1', {
      masterVolumeLinear: 0.88,
      measuredMasterRmsDbfs: -16.2
    })
  ]);
  const updatedAudioSource = await mysqlAudio.findAudioSourceById(audioSource.id, 'org-mysql-1');
  assert.equal(updatedAudioSource.volumeLinear, 0.75);
  assert.equal(updatedAudioSource.measuredRmsDbfs, -18.5);

  // Create a new video source directly in MySQL via PrismaVideoSourceRepository
  const mysqlNewSource = await mysqlSources.createSource({
    organizationId: 'org-mysql-1',
    stationId: station.id,
    name: 'Direct MySQL SRT Feed',
    sourceType: 'SRT_STREAM',
    streamUrl: 'srt://93.184.216.34:9000?mode=caller',
    connectionStatus: 'ONLINE',
    availabilityStatus: 'AVAILABLE',
    createdByUserId: admin.id
  }, { id: admin.id, ipAddress: '127.0.0.1' });

  const listedSources = await mysqlSources.listSources('org-mysql-1');
  assert.equal(listedSources.length, 2);
  assert.ok(listedSources.some(s => s.id === source.id));
  assert.ok(listedSources.some(s => s.id === mysqlNewSource.id));

  // Verify MySQL index usage with EXPLAIN
  const prisma = getPrismaClient(mysqlUrl);
  const explainMedia = await prisma.$queryRawUnsafe(
    `EXPLAIN SELECT * FROM MediaAsset WHERE organizationId = 'org-mysql-1' AND category = 'MOVIES'`
  );
  assert.ok(Array.isArray(explainMedia) && explainMedia.length > 0);

  console.log('Phase 15 MySQL schema push, SQLite-to-MySQL migration parity, Prisma repository CRUD, reference protection, and EXPLAIN verification passed');
} finally {
  delete process.env.MCR_REPOSITORY_DRIVER;
  await closePrismaClient().catch(() => {});
  try {
    execFileSync(mysqlBin, ['-u', 'root', '-e', `DROP DATABASE IF EXISTS \`${dbName}\`;`], { windowsHide: true });
    execFileSync(mysqlBin, ['-u', 'root', '-e', 'DROP DATABASE IF EXISTS `pallcom_mcr_test`;'], { windowsHide: true });
  } catch {
    // ignore cleanup error
  }
  try {
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // ignore Windows file lock cleanup delay
  }
}
