import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { env } from '../../config/env.js';

let dbInstance = null;

export function getSqliteDatabase() {
  if (dbInstance) return dbInstance;

  const dbPath = path.resolve(process.cwd(), env.SQLITE_DB_PATH);
  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  dbInstance = new DatabaseSync(dbPath);
  dbInstance.exec('PRAGMA busy_timeout = 3000');

  // Initialize SQLite tables matching the domain schema
  dbInstance.exec(`
    CREATE TABLE IF NOT EXISTS organizations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      passwordHash TEXT NOT NULL,
      fullName TEXT NOT NULL,
      isActive INTEGER DEFAULT 1,
      role TEXT DEFAULT 'OPERATOR',
      organizationId TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS studios (
      id TEXT PRIMARY KEY,
      organizationId TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS stations (
      id TEXT PRIMARY KEY,
      organizationId TEXT NOT NULL,
      studioId TEXT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      description TEXT,
      ipAddress TEXT DEFAULT '127.0.0.1',
      obsPort INTEGER DEFAULT 4455,
      encryptedPassword TEXT,
      status TEXT DEFAULT 'OFFLINE',
      streamStatus TEXT DEFAULT 'STOPPED',
      recordStatus TEXT DEFAULT 'STOPPED',
      currentProgramScene TEXT,
      currentPreviewScene TEXT,
      fps REAL DEFAULT 0.0,
      cpuUsage REAL DEFAULT 0.0,
      memoryUsage REAL DEFAULT 0.0,
      droppedFrames INTEGER DEFAULT 0,
      lastHeartbeat TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS program_station_selection (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      stationId TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pairing_tokens (
      id TEXT PRIMARY KEY,
      stationId TEXT NOT NULL,
      pairingCode TEXT NOT NULL,
      tokenHash TEXT NOT NULL,
      expiresAt TEXT NOT NULL,
      usedAt TEXT,
      createdByUserId TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS station_agent_credentials (
      stationId TEXT PRIMARY KEY REFERENCES stations(id) ON DELETE CASCADE,
      generation INTEGER NOT NULL CHECK(generation > 0)
    );

    CREATE TABLE IF NOT EXISTS station_automations (
      id TEXT PRIMARY KEY, organizationId TEXT NOT NULL, userId TEXT NOT NULL,
      stationId TEXT NOT NULL, name TEXT NOT NULL, action TEXT NOT NULL, sceneName TEXT,
      runAt TEXT, status TEXT NOT NULL, error TEXT
    );

    CREATE TABLE IF NOT EXISTS station_graphics_tokens (
      stationId TEXT PRIMARY KEY, token TEXT NOT NULL UNIQUE, expiresAt INTEGER
    );

    CREATE TABLE IF NOT EXISTS station_graphics (
      stationId TEXT NOT NULL, kind TEXT NOT NULL, content TEXT NOT NULL,
      image TEXT NOT NULL, imageRevision TEXT NOT NULL,
      published INTEGER NOT NULL DEFAULT 0, expiresAt INTEGER,
      PRIMARY KEY (stationId, kind)
    );

    CREATE TABLE IF NOT EXISTS program_schedule (
      id TEXT PRIMARY KEY, stationId TEXT NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
      userId TEXT NOT NULL, sceneId TEXT NOT NULL, scene TEXT NOT NULL,
      dueAt INTEGER NOT NULL, state TEXT NOT NULL, executedAt INTEGER, error TEXT,
      UNIQUE(stationId,dueAt)
    );
    CREATE TABLE IF NOT EXISTS program_schedule_hold (
      stationId TEXT PRIMARY KEY REFERENCES stations(id) ON DELETE CASCADE, resumedAt INTEGER
    );
    CREATE TABLE IF NOT EXISTS program_schedule_daily (
      jobId TEXT PRIMARY KEY REFERENCES program_schedule(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS program_resume_source (
      stationId TEXT PRIMARY KEY REFERENCES stations(id) ON DELETE CASCADE, selection TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS program_named_scenes (
      stationId TEXT NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
      id TEXT NOT NULL, scene TEXT NOT NULL, PRIMARY KEY (stationId,id)
    );
    CREATE TABLE IF NOT EXISTS program_local_scenes (
      stationId TEXT PRIMARY KEY REFERENCES stations(id) ON DELETE CASCADE, scene TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS program_ads (stationId TEXT PRIMARY KEY, plan TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS ad_asset_audio (
      stationId TEXT NOT NULL, asset TEXT NOT NULL, pcm BLOB NOT NULL,
      PRIMARY KEY (stationId, asset),
      FOREIGN KEY (stationId, asset) REFERENCES ad_assets(stationId,id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS ad_assets (
      stationId TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL,
      frames INTEGER NOT NULL, media BLOB NOT NULL, PRIMARY KEY(stationId,id)
    );
    CREATE TABLE IF NOT EXISTS ad_frames (
      stationId TEXT NOT NULL, asset TEXT NOT NULL, frame INTEGER NOT NULL, data BLOB NOT NULL,
      PRIMARY KEY(stationId,asset,frame)
    );
    CREATE TABLE IF NOT EXISTS program_watermarks (
      stationId TEXT PRIMARY KEY, revision INTEGER NOT NULL, settings TEXT NOT NULL, bitmap TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS program_tickers (
      stationId TEXT PRIMARY KEY REFERENCES stations(id) ON DELETE CASCADE,
      revision INTEGER NOT NULL, settings TEXT NOT NULL, bitmap TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS station_playout (
      stationId TEXT PRIMARY KEY, plan TEXT NOT NULL, state TEXT NOT NULL,
      assets TEXT NOT NULL DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS playout_as_run (
      id TEXT PRIMARY KEY, stationId TEXT NOT NULL, itemId TEXT NOT NULL,
      title TEXT NOT NULL, category TEXT NOT NULL, sceneName TEXT, plannedAt INTEGER,
      startedAt INTEGER, endedAt INTEGER, outcome TEXT NOT NULL, detail TEXT
    );
    CREATE INDEX IF NOT EXISTS playout_as_run_station ON playout_as_run (stationId, startedAt DESC);

    CREATE TABLE IF NOT EXISTS auth_sessions (
      id TEXT PRIMARY KEY, userId TEXT NOT NULL, refreshHash TEXT NOT NULL, expiresAt INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS auth_sessions_expiry ON auth_sessions(expiresAt);
    CREATE INDEX IF NOT EXISTS auth_sessions_user ON auth_sessions(userId);
    CREATE TRIGGER IF NOT EXISTS revoke_auth_sessions_on_account_change
    AFTER UPDATE OF isActive, passwordHash ON users
    WHEN NEW.isActive = 0 OR NEW.passwordHash IS NOT OLD.passwordHash
    BEGIN
      DELETE FROM auth_sessions WHERE userId = NEW.id;
    END;

    CREATE TABLE IF NOT EXISTS password_reset_grants (
      userId TEXT PRIMARY KEY, tokenHash TEXT NOT NULL UNIQUE, expiresAt INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS password_reset_grants_expiry ON password_reset_grants(expiresAt);
    CREATE TRIGGER IF NOT EXISTS revoke_password_reset_on_account_change
    AFTER UPDATE OF isActive, passwordHash ON users
    WHEN NEW.isActive = 0 OR NEW.passwordHash IS NOT OLD.passwordHash
    BEGIN
      DELETE FROM password_reset_grants WHERE userId = NEW.id;
    END;
    CREATE TABLE IF NOT EXISTS auth_mfa (
      userId TEXT PRIMARY KEY, encryptedSecret TEXT NOT NULL, enabled INTEGER NOT NULL,
      pendingUntil INTEGER NOT NULL, lastStep INTEGER NOT NULL DEFAULT -1
    );
    CREATE TABLE IF NOT EXISTS auth_mfa_recovery_codes (
      userId TEXT NOT NULL, codeHash TEXT NOT NULL, PRIMARY KEY (userId, codeHash)
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      organizationId TEXT NOT NULL,
      userId TEXT,
      action TEXT NOT NULL,
      resourceType TEXT NOT NULL,
      resourceId TEXT,
      details TEXT,
      ipAddress TEXT,
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS media_assets (
      id TEXT PRIMARY KEY,
      organizationId TEXT NOT NULL,
      folder TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL,
      kind TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]',
      channelIds TEXT NOT NULL DEFAULT '[]',
      originalFilename TEXT NOT NULL,
      storageKey TEXT NOT NULL UNIQUE,
      thumbnailKey TEXT,
      previewKey TEXT,
      sizeBytes INTEGER NOT NULL,
      checksumSha256 TEXT NOT NULL,
      mimeType TEXT NOT NULL,
      containerFormat TEXT,
      videoCodec TEXT,
      audioCodec TEXT,
      width INTEGER,
      height INTEGER,
      frameRate REAL,
      durationSeconds REAL,
      bitrateBps INTEGER,
      audioChannels INTEGER,
      sampleRateHz INTEGER,
      hasVideo INTEGER NOT NULL DEFAULT 0,
      hasAudio INTEGER NOT NULL DEFAULT 0,
      uploadStatus TEXT NOT NULL,
      processingStatus TEXT NOT NULL,
      broadcastCompatibility TEXT NOT NULL,
      compatibilityNotes TEXT NOT NULL DEFAULT '[]',
      errorReason TEXT,
      createdByUserId TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS media_assets_org_cat ON media_assets (organizationId, category, createdAt DESC);
    CREATE INDEX IF NOT EXISTS media_assets_org_status ON media_assets (organizationId, processingStatus, createdAt DESC);
    CREATE INDEX IF NOT EXISTS media_assets_org_checksum ON media_assets (organizationId, checksumSha256);

    CREATE TABLE IF NOT EXISTS media_upload_sessions (
      id TEXT PRIMARY KEY,
      organizationId TEXT NOT NULL,
      createdByUserId TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      folder TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]',
      channelIds TEXT NOT NULL DEFAULT '[]',
      originalFilename TEXT NOT NULL,
      declaredMimeType TEXT NOT NULL DEFAULT '',
      expectedSizeBytes INTEGER NOT NULL,
      expectedChecksumSha256 TEXT,
      receivedBytes INTEGER NOT NULL DEFAULT 0,
      chunkSizeBytes INTEGER NOT NULL,
      uploadKey TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL,
      assetId TEXT,
      errorReason TEXT,
      expiresAt INTEGER NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS media_upload_sessions_org ON media_upload_sessions (organizationId, status, expiresAt);

    CREATE TABLE IF NOT EXISTS media_processing_jobs (
      id TEXT PRIMARY KEY,
      assetId TEXT NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
      organizationId TEXT NOT NULL,
      jobType TEXT NOT NULL,
      status TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      errorReason TEXT,
      startedAt TEXT,
      completedAt TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS media_processing_jobs_status ON media_processing_jobs (status, createdAt);

    CREATE TABLE IF NOT EXISTS media_playlists (
      id TEXT PRIMARY KEY,
      organizationId TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL,
      channelId TEXT,
      items TEXT NOT NULL DEFAULT '[]',
      createdByUserId TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS media_playlists_org ON media_playlists (organizationId, kind, createdAt DESC);

    CREATE TABLE IF NOT EXISTS video_sources (
      id TEXT PRIMARY KEY,
      organizationId TEXT NOT NULL,
      stationId TEXT,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      sourceType TEXT NOT NULL,
      mediaAssetId TEXT,
      playlistId TEXT,
      streamUrl TEXT,
      encryptedSecret TEXT,
      serverFilePath TEXT,
      connectionStatus TEXT NOT NULL DEFAULT 'OFFLINE',
      availabilityStatus TEXT NOT NULL DEFAULT 'UNAVAILABLE',
      width INTEGER,
      height INTEGER,
      frameRate REAL,
      videoCodec TEXT,
      audioCodec TEXT,
      hasAudio INTEGER NOT NULL DEFAULT 0,
      previewThumbnailKey TEXT,
      lastConnectedAt TEXT,
      lastProbedAt TEXT,
      lastError TEXT,
      reconnectEnabled INTEGER NOT NULL DEFAULT 1,
      maxRetries INTEGER NOT NULL DEFAULT 5,
      retryCount INTEGER NOT NULL DEFAULT 0,
      backoffBaseMs INTEGER NOT NULL DEFAULT 2000,
      backoffMaxMs INTEGER NOT NULL DEFAULT 30000,
      fallbackSourceId TEXT,
      fallbackAssetId TEXT,
      fallbackMode TEXT NOT NULL DEFAULT 'SLATE',
      createdByUserId TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS video_sources_org_type ON video_sources (organizationId, sourceType, createdAt DESC);
    CREATE INDEX IF NOT EXISTS video_sources_org_station ON video_sources (organizationId, stationId);
    CREATE INDEX IF NOT EXISTS video_sources_org_avail ON video_sources (organizationId, availabilityStatus);

    CREATE TABLE IF NOT EXISTS audio_sources (
      id TEXT PRIMARY KEY,
      organizationId TEXT NOT NULL,
      channelId TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      sourceType TEXT NOT NULL,
      mediaAssetId TEXT,
      playlistId TEXT,
      videoSourceId TEXT,
      obsInputName TEXT,
      streamUrl TEXT,
      encryptedSecret TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      muted INTEGER NOT NULL DEFAULT 0,
      soloMonitoring INTEGER NOT NULL DEFAULT 0,
      volumeLinear REAL NOT NULL DEFAULT 1.0,
      gainDb REAL NOT NULL DEFAULT 0.0,
      delayMs INTEGER NOT NULL DEFAULT 0,
      fadeInMs INTEGER NOT NULL DEFAULT 500,
      fadeOutMs INTEGER NOT NULL DEFAULT 500,
      priority INTEGER NOT NULL DEFAULT 50,
      duckingTrigger INTEGER NOT NULL DEFAULT 0,
      duckingTarget INTEGER NOT NULL DEFAULT 1,
      repeatMode TEXT NOT NULL DEFAULT 'REPEAT_PLAYLIST',
      shuffleEnabled INTEGER NOT NULL DEFAULT 0,
      crossfadeMs INTEGER NOT NULL DEFAULT 1500,
      currentTrackIndex INTEGER NOT NULL DEFAULT 0,
      currentTrackAssetId TEXT,
      playbackPositionMs INTEGER NOT NULL DEFAULT 0,
      remainingDurationMs INTEGER,
      state TEXT NOT NULL DEFAULT 'ONLINE',
      measuredRmsDbfs REAL NOT NULL DEFAULT -90.0,
      measuredPeakDbfs REAL NOT NULL DEFAULT -90.0,
      clippingDetected INTEGER NOT NULL DEFAULT 0,
      codec TEXT,
      sampleRateHz INTEGER DEFAULT 48000,
      channels INTEGER DEFAULT 2,
      streamMetadata TEXT,
      reconnectEnabled INTEGER NOT NULL DEFAULT 1,
      maxRetries INTEGER NOT NULL DEFAULT 5,
      retryCount INTEGER NOT NULL DEFAULT 0,
      backoffBaseMs INTEGER NOT NULL DEFAULT 2000,
      backoffMaxMs INTEGER NOT NULL DEFAULT 30000,
      fallbackSourceId TEXT,
      fallbackAssetId TEXT,
      lastConnectedAt TEXT,
      lastError TEXT,
      createdByUserId TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS audio_sources_org_channel ON audio_sources (organizationId, channelId, priority DESC, createdAt ASC);
    CREATE INDEX IF NOT EXISTS audio_sources_org_type ON audio_sources (organizationId, sourceType);

    CREATE TABLE IF NOT EXISTS audio_mixer_configs (
      channelId TEXT NOT NULL,
      organizationId TEXT NOT NULL,
      masterVolumeLinear REAL NOT NULL DEFAULT 1.0,
      masterGainDb REAL NOT NULL DEFAULT 0.0,
      masterMuted INTEGER NOT NULL DEFAULT 0,
      routingMode TEXT NOT NULL DEFAULT 'MIX_VIDEO_AND_EXTERNAL_AUDIO',
      cameraAudioMuted INTEGER NOT NULL DEFAULT 1,
      cameraAudioGainDb REAL NOT NULL DEFAULT -6.0,
      duckingEnabled INTEGER NOT NULL DEFAULT 1,
      duckingThresholdDbfs REAL NOT NULL DEFAULT -32.0,
      duckingReductionDb REAL NOT NULL DEFAULT -12.0,
      duckingAttackMs INTEGER NOT NULL DEFAULT 120,
      duckingHoldMs INTEGER NOT NULL DEFAULT 300,
      duckingReleaseMs INTEGER NOT NULL DEFAULT 600,
      crossfadeDurationMs INTEGER NOT NULL DEFAULT 1500,
      adAudioPolicy TEXT NOT NULL DEFAULT 'REPLACE_MUSIC_PAUSE_PLAYLIST',
      adActive INTEGER NOT NULL DEFAULT 0,
      peakLimiterCeilingDbfs REAL NOT NULL DEFAULT -1.0,
      loudnessNormalization INTEGER NOT NULL DEFAULT 0,
      targetLoudnessLufs REAL NOT NULL DEFAULT -23.0,
      silenceThresholdDbfs REAL NOT NULL DEFAULT -60.0,
      silenceTimeoutSeconds INTEGER NOT NULL DEFAULT 10,
      fallbackSourceId TEXT,
      fallbackAssetId TEXT,
      outputCodec TEXT NOT NULL DEFAULT 'aac_lc',
      outputSampleRateHz INTEGER NOT NULL DEFAULT 48000,
      outputChannels INTEGER NOT NULL DEFAULT 2,
      outputBitrateKbps INTEGER NOT NULL DEFAULT 192,
      measuredMasterRmsDbfs REAL NOT NULL DEFAULT -90.0,
      measuredMasterPeakDbfs REAL NOT NULL DEFAULT -90.0,
      masterClippingPrevented INTEGER NOT NULL DEFAULT 0,
      updatedByUserId TEXT,
      updatedAt TEXT NOT NULL,
      PRIMARY KEY (channelId, organizationId)
    );

    CREATE TABLE IF NOT EXISTS channel_playout_configs (
      channelId TEXT NOT NULL,
      organizationId TEXT NOT NULL,
      playoutMode TEXT NOT NULL DEFAULT 'CAMERA_ROTATION',
      desiredState TEXT NOT NULL DEFAULT 'STOPPED',
      runtimeState TEXT NOT NULL DEFAULT 'STOPPED',
      autoStart INTEGER NOT NULL DEFAULT 0,
      width INTEGER NOT NULL DEFAULT 1920,
      height INTEGER NOT NULL DEFAULT 1080,
      frameRate INTEGER NOT NULL DEFAULT 25,
      videoCodec TEXT NOT NULL DEFAULT 'h264',
      videoBitrateKbps INTEGER NOT NULL DEFAULT 4500,
      gopFrames INTEGER NOT NULL DEFAULT 50,
      audioCodec TEXT NOT NULL DEFAULT 'aac_lc',
      audioSampleRateHz INTEGER NOT NULL DEFAULT 48000,
      audioChannels INTEGER NOT NULL DEFAULT 2,
      audioBitrateKbps INTEGER NOT NULL DEFAULT 192,
      hwAccelMode TEXT NOT NULL DEFAULT 'AUTO_WITH_SW_FALLBACK',
      activeEncoder TEXT NOT NULL DEFAULT 'x264enc',
      cameraSequence TEXT NOT NULL DEFAULT '[]',
      cameraRepeat INTEGER NOT NULL DEFAULT 1,
      activeCameraIndex INTEGER NOT NULL DEFAULT 0,
      currentSourceId TEXT,
      movieQueue TEXT NOT NULL DEFAULT '[]',
      movieRepeat INTEGER NOT NULL DEFAULT 1,
      activeMovieIndex INTEGER NOT NULL DEFAULT 0,
      currentMediaAssetId TEXT,
      playbackPositionMs INTEGER NOT NULL DEFAULT 0,
      remainingDurationMs INTEGER,
      paused INTEGER NOT NULL DEFAULT 0,
      adSchedulePolicy TEXT NOT NULL DEFAULT '{}',
      adState TEXT NOT NULL DEFAULT '{}',
      graphicsConfig TEXT NOT NULL DEFAULT '{}',
      fallbackConfig TEXT NOT NULL DEFAULT '{}',
      fallbackActive INTEGER NOT NULL DEFAULT 0,
      emergencyActive INTEGER NOT NULL DEFAULT 0,
      emergencySourceId TEXT,
      networkAllowlist TEXT NOT NULL DEFAULT '[]',
      outputUdpPort INTEGER,
      outputHlsEnabled INTEGER NOT NULL DEFAULT 1,
      outputSrtUrl TEXT,
      workerSessionId TEXT,
      workerPid INTEGER,
      restartCount INTEGER NOT NULL DEFAULT 0,
      lastHeartbeatAt TEXT,
      lastOutputAt TEXT,
      lastRecoveryAt TEXT,
      lastError TEXT,
      revision INTEGER NOT NULL DEFAULT 1,
      updatedByUserId TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      PRIMARY KEY (channelId, organizationId)
    );
    CREATE INDEX IF NOT EXISTS channel_playout_configs_org_state ON channel_playout_configs (organizationId, desiredState, runtimeState);

    CREATE TABLE IF NOT EXISTS channel_schedule_revisions (
      id TEXT PRIMARY KEY,
      organizationId TEXT NOT NULL,
      channelId TEXT NOT NULL,
      revisionNumber INTEGER NOT NULL,
      name TEXT NOT NULL DEFAULT 'Broadcast Schedule',
      timezone TEXT NOT NULL DEFAULT 'UTC',
      lifecycleState TEXT NOT NULL DEFAULT 'DRAFT',
      activationPolicy TEXT NOT NULL DEFAULT 'APPLY_NEXT_BOUNDARY',
      effectiveFromUtc TEXT,
      gapPolicy TEXT NOT NULL DEFAULT 'FALLBACK_PLAYLIST',
      gapFallbackAssetId TEXT,
      gapFallbackSourceId TEXT,
      gapFallbackPlaylistId TEXT,
      events TEXT NOT NULL DEFAULT '[]',
      templates TEXT NOT NULL DEFAULT '[]',
      validationSummary TEXT NOT NULL DEFAULT '{}',
      publishedByUserId TEXT,
      publishedAt TEXT,
      createdByUserId TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      UNIQUE (organizationId, channelId, revisionNumber)
    );
    CREATE INDEX IF NOT EXISTS channel_schedule_revisions_org_ch_state ON channel_schedule_revisions (organizationId, channelId, lifecycleState, revisionNumber DESC);

    CREATE TABLE IF NOT EXISTS channel_scheduler_execution_states (
      channelId TEXT NOT NULL,
      organizationId TEXT NOT NULL,
      activeRevisionId TEXT,
      activeRevisionNumber INTEGER NOT NULL DEFAULT 0,
      pendingRevisionId TEXT,
      pendingActivationPolicy TEXT,
      pendingEffectiveAtUtc TEXT,
      timezone TEXT NOT NULL DEFAULT 'UTC',
      schedulerRunning INTEGER NOT NULL DEFAULT 0,
      holdActive INTEGER NOT NULL DEFAULT 0,
      emergencyOverrideActive INTEGER NOT NULL DEFAULT 0,
      manualOverrideActive INTEGER NOT NULL DEFAULT 0,
      overrideSourceId TEXT,
      overrideExpiresAtUtc TEXT,
      currentTrackStates TEXT NOT NULL DEFAULT '{}',
      claimedOccurrenceIds TEXT NOT NULL DEFAULT '[]',
      interruptedProgramState TEXT NOT NULL DEFAULT '{}',
      gapFallbackActive INTEGER NOT NULL DEFAULT 0,
      leaseOwnerId TEXT,
      leaseExpiresAt INTEGER NOT NULL DEFAULT 0,
      lastHeartbeatAt TEXT,
      lastReconciledAt TEXT,
      updatedAt TEXT NOT NULL,
      PRIMARY KEY (channelId, organizationId)
    );

    CREATE TABLE IF NOT EXISTS channel_as_run_logs (
      id TEXT PRIMARY KEY,
      organizationId TEXT NOT NULL,
      channelId TEXT NOT NULL,
      revisionId TEXT,
      revisionNumber INTEGER NOT NULL DEFAULT 0,
      eventId TEXT NOT NULL,
      occurrenceId TEXT NOT NULL UNIQUE,
      trackType TEXT NOT NULL,
      executionMode TEXT NOT NULL,
      title TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'PROGRAM',
      mediaAssetId TEXT,
      videoSourceId TEXT,
      audioSourceId TEXT,
      plannedStartUtc TEXT NOT NULL,
      actualStartUtc TEXT NOT NULL,
      plannedEndUtc TEXT NOT NULL,
      actualEndUtc TEXT,
      plannedDurationMs INTEGER NOT NULL,
      actualDurationMs INTEGER,
      status TEXT NOT NULL DEFAULT 'RUNNING',
      interruptionReason TEXT,
      resumeOffsetMs INTEGER NOT NULL DEFAULT 0,
      workerConfirmed INTEGER NOT NULL DEFAULT 0,
      details TEXT NOT NULL DEFAULT '{}',
      createdAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS channel_as_run_logs_org_ch_time ON channel_as_run_logs (organizationId, channelId, actualStartUtc DESC);
  `);

  const graphicsHasExpiry = () => dbInstance.prepare('PRAGMA table_info(station_graphics_tokens)')
    .all().some(column => column.name === 'expiresAt');
  try {
    if (!graphicsHasExpiry()) {
      dbInstance.exec('BEGIN IMMEDIATE');
      try {
        if (!graphicsHasExpiry()) dbInstance.exec('ALTER TABLE station_graphics_tokens ADD COLUMN expiresAt INTEGER');
        dbInstance.exec('COMMIT');
      } catch (error) {
        dbInstance.exec('ROLLBACK');
        throw error;
      }
    }
  } catch (error) {
    dbInstance.close();
    dbInstance = null;
    throw error;
  }

  return dbInstance;
}
