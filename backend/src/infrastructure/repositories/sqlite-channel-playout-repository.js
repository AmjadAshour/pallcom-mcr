import { IChannelPlayoutRepository } from '@mcr/domain';
import { CHANNEL_DESIRED_STATES, CHANNEL_RUNTIME_STATES } from '@mcr/shared';
import { getSqliteDatabase } from '../database/sqlite.js';
import { insertAuditEvent } from './sqlite-audit-repository.js';

function parseJson(raw, fallback) {
  try {
    if (raw === null || raw === undefined || raw === '') return fallback;
    if (typeof raw === 'object') return raw;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function defaultChannelPlayoutConfig(channelId, organizationId) {
  const nowIso = new Date().toISOString();
  return {
    channelId,
    organizationId,
    playoutMode: 'CAMERA_ROTATION',
    desiredState: CHANNEL_DESIRED_STATES.STOPPED,
    runtimeState: CHANNEL_RUNTIME_STATES.STOPPED,
    autoStart: false,
    width: 1920,
    height: 1080,
    frameRate: 25,
    videoCodec: 'h264',
    videoBitrateKbps: 4500,
    gopFrames: 50,
    audioCodec: 'aac_lc',
    audioSampleRateHz: 48000,
    audioChannels: 2,
    audioBitrateKbps: 192,
    hwAccelMode: 'AUTO_WITH_SW_FALLBACK',
    activeEncoder: 'x264enc',
    cameraSequence: [],
    cameraRepeat: true,
    activeCameraIndex: 0,
    currentSourceId: null,
    movieQueue: [],
    movieRepeat: true,
    activeMovieIndex: 0,
    currentMediaAssetId: null,
    playbackPositionMs: 0,
    remainingDurationMs: null,
    paused: false,
    adSchedulePolicy: { enabled: false, intervalMovies: 1, adAssetIds: [] },
    adState: { active: false, currentAdAssetId: null, resumeMovieIndex: 0, resumePositionMs: 0 },
    graphicsConfig: { watermarkEnabled: true, tickerEnabled: false, tickerText: '' },
    fallbackConfig: { mode: 'BLACK_SLATE', fallbackSourceId: null, fallbackAssetId: null, fallbackPlaylistId: null },
    fallbackActive: false,
    emergencyActive: false,
    emergencySourceId: null,
    networkAllowlist: [],
    outputUdpPort: null,
    outputHlsEnabled: true,
    outputSrtUrl: null,
    workerSessionId: null,
    workerPid: null,
    restartCount: 0,
    lastHeartbeatAt: null,
    lastOutputAt: null,
    lastRecoveryAt: null,
    lastError: null,
    revision: 1,
    updatedByUserId: null,
    createdAt: nowIso,
    updatedAt: nowIso
  };
}

export function mapChannelPlayoutConfigRow(row) {
  if (!row) return null;
  return {
    channelId: row.channelId,
    organizationId: row.organizationId,
    playoutMode: row.playoutMode || 'CAMERA_ROTATION',
    desiredState: row.desiredState || CHANNEL_DESIRED_STATES.STOPPED,
    runtimeState: row.runtimeState || CHANNEL_RUNTIME_STATES.STOPPED,
    autoStart: Boolean(row.autoStart),
    width: Number(row.width ?? 1920),
    height: Number(row.height ?? 1080),
    frameRate: Number(row.frameRate ?? 25),
    videoCodec: row.videoCodec || 'h264',
    videoBitrateKbps: Number(row.videoBitrateKbps ?? 4500),
    gopFrames: Number(row.gopFrames ?? 50),
    audioCodec: row.audioCodec || 'aac_lc',
    audioSampleRateHz: Number(row.audioSampleRateHz ?? 48000),
    audioChannels: Number(row.audioChannels ?? 2),
    audioBitrateKbps: Number(row.audioBitrateKbps ?? 192),
    hwAccelMode: row.hwAccelMode || 'AUTO_WITH_SW_FALLBACK',
    activeEncoder: row.activeEncoder || 'x264enc',
    cameraSequence: parseJson(row.cameraSequence, []),
    cameraRepeat: Boolean(row.cameraRepeat),
    activeCameraIndex: Number(row.activeCameraIndex ?? 0),
    currentSourceId: row.currentSourceId || null,
    movieQueue: parseJson(row.movieQueue, []),
    movieRepeat: Boolean(row.movieRepeat),
    activeMovieIndex: Number(row.activeMovieIndex ?? 0),
    currentMediaAssetId: row.currentMediaAssetId || null,
    playbackPositionMs: Number(row.playbackPositionMs ?? 0),
    remainingDurationMs: row.remainingDurationMs !== null && row.remainingDurationMs !== undefined
      ? Number(row.remainingDurationMs)
      : null,
    paused: Boolean(row.paused),
    adSchedulePolicy: parseJson(row.adSchedulePolicy, { enabled: false, intervalMovies: 1, adAssetIds: [] }),
    adState: parseJson(row.adState, { active: false, currentAdAssetId: null, resumeMovieIndex: 0, resumePositionMs: 0 }),
    graphicsConfig: parseJson(row.graphicsConfig, { watermarkEnabled: true, tickerEnabled: false, tickerText: '' }),
    fallbackConfig: parseJson(row.fallbackConfig, { mode: 'BLACK_SLATE', fallbackSourceId: null, fallbackAssetId: null, fallbackPlaylistId: null }),
    fallbackActive: Boolean(row.fallbackActive),
    emergencyActive: Boolean(row.emergencyActive),
    emergencySourceId: row.emergencySourceId || null,
    networkAllowlist: parseJson(row.networkAllowlist, []),
    outputUdpPort: row.outputUdpPort !== null && row.outputUdpPort !== undefined ? Number(row.outputUdpPort) : null,
    outputHlsEnabled: Boolean(row.outputHlsEnabled),
    outputSrtUrl: row.outputSrtUrl || null,
    workerSessionId: row.workerSessionId || null,
    workerPid: row.workerPid !== null && row.workerPid !== undefined ? Number(row.workerPid) : null,
    restartCount: Number(row.restartCount ?? 0),
    lastHeartbeatAt: row.lastHeartbeatAt ? new Date(row.lastHeartbeatAt).toISOString() : null,
    lastOutputAt: row.lastOutputAt ? new Date(row.lastOutputAt).toISOString() : null,
    lastRecoveryAt: row.lastRecoveryAt ? new Date(row.lastRecoveryAt).toISOString() : null,
    lastError: row.lastError || null,
    revision: Number(row.revision ?? 1),
    updatedByUserId: row.updatedByUserId || null,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt)
  };
}

export class SqliteChannelPlayoutRepository extends IChannelPlayoutRepository {
  get db() {
    return getSqliteDatabase();
  }

  async getChannelConfig(channelId, organizationId) {
    const row = this.db.prepare(
      'SELECT * FROM channel_playout_configs WHERE channelId = ? AND organizationId = ?'
    ).get(channelId, organizationId);
    if (row) return mapChannelPlayoutConfigRow(row);
    return defaultChannelPlayoutConfig(channelId, organizationId);
  }

  async listChannelConfigs(organizationId) {
    const rows = this.db.prepare(
      'SELECT * FROM channel_playout_configs WHERE organizationId = ? ORDER BY createdAt ASC'
    ).all(organizationId);
    return rows.map(mapChannelPlayoutConfigRow);
  }

  async saveChannelConfig(channelId, organizationId, updates, actor) {
    const db = this.db;
    const existingRow = db.prepare(
      'SELECT * FROM channel_playout_configs WHERE channelId = ? AND organizationId = ?'
    ).get(channelId, organizationId);
    const current = existingRow ? mapChannelPlayoutConfigRow(existingRow) : defaultChannelPlayoutConfig(channelId, organizationId);

    if (updates.expectedRevision !== undefined && existingRow && Number(updates.expectedRevision) !== current.revision) {
      throw Object.assign(new Error('Channel playout configuration was modified by another session (revision mismatch)'), {
        statusCode: 409
      });
    }

    const nowIso = new Date().toISOString();
    const nextRevision = existingRow ? current.revision + 1 : 1;
    const merged = {
      ...current,
      ...updates,
      channelId,
      organizationId,
      revision: nextRevision,
      updatedByUserId: actor?.id || current.updatedByUserId,
      createdAt: existingRow ? current.createdAt : nowIso,
      updatedAt: nowIso
    };

    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(`
        INSERT INTO channel_playout_configs (
          channelId, organizationId, playoutMode, desiredState, runtimeState, autoStart,
          width, height, frameRate, videoCodec, videoBitrateKbps, gopFrames,
          audioCodec, audioSampleRateHz, audioChannels, audioBitrateKbps,
          hwAccelMode, activeEncoder,
          cameraSequence, cameraRepeat, activeCameraIndex, currentSourceId,
          movieQueue, movieRepeat, activeMovieIndex, currentMediaAssetId,
          playbackPositionMs, remainingDurationMs, paused,
          adSchedulePolicy, adState, graphicsConfig, fallbackConfig,
          fallbackActive, emergencyActive, emergencySourceId,
          networkAllowlist, outputUdpPort, outputHlsEnabled, outputSrtUrl,
          workerSessionId, workerPid, restartCount,
          lastHeartbeatAt, lastOutputAt, lastRecoveryAt, lastError,
          revision, updatedByUserId, createdAt, updatedAt
        ) VALUES (
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?
        ) ON CONFLICT(channelId, organizationId) DO UPDATE SET
          playoutMode = excluded.playoutMode,
          desiredState = excluded.desiredState,
          runtimeState = excluded.runtimeState,
          autoStart = excluded.autoStart,
          width = excluded.width,
          height = excluded.height,
          frameRate = excluded.frameRate,
          videoCodec = excluded.videoCodec,
          videoBitrateKbps = excluded.videoBitrateKbps,
          gopFrames = excluded.gopFrames,
          audioCodec = excluded.audioCodec,
          audioSampleRateHz = excluded.audioSampleRateHz,
          audioChannels = excluded.audioChannels,
          audioBitrateKbps = excluded.audioBitrateKbps,
          hwAccelMode = excluded.hwAccelMode,
          activeEncoder = excluded.activeEncoder,
          cameraSequence = excluded.cameraSequence,
          cameraRepeat = excluded.cameraRepeat,
          activeCameraIndex = excluded.activeCameraIndex,
          currentSourceId = excluded.currentSourceId,
          movieQueue = excluded.movieQueue,
          movieRepeat = excluded.movieRepeat,
          activeMovieIndex = excluded.activeMovieIndex,
          currentMediaAssetId = excluded.currentMediaAssetId,
          playbackPositionMs = excluded.playbackPositionMs,
          remainingDurationMs = excluded.remainingDurationMs,
          paused = excluded.paused,
          adSchedulePolicy = excluded.adSchedulePolicy,
          adState = excluded.adState,
          graphicsConfig = excluded.graphicsConfig,
          fallbackConfig = excluded.fallbackConfig,
          fallbackActive = excluded.fallbackActive,
          emergencyActive = excluded.emergencyActive,
          emergencySourceId = excluded.emergencySourceId,
          networkAllowlist = excluded.networkAllowlist,
          outputUdpPort = excluded.outputUdpPort,
          outputHlsEnabled = excluded.outputHlsEnabled,
          outputSrtUrl = excluded.outputSrtUrl,
          workerSessionId = excluded.workerSessionId,
          workerPid = excluded.workerPid,
          restartCount = excluded.restartCount,
          lastHeartbeatAt = excluded.lastHeartbeatAt,
          lastOutputAt = excluded.lastOutputAt,
          lastRecoveryAt = excluded.lastRecoveryAt,
          lastError = excluded.lastError,
          revision = excluded.revision,
          updatedByUserId = excluded.updatedByUserId,
          updatedAt = excluded.updatedAt
      `).run(
        channelId,
        organizationId,
        merged.playoutMode,
        merged.desiredState,
        merged.runtimeState,
        merged.autoStart ? 1 : 0,
        merged.width,
        merged.height,
        merged.frameRate,
        merged.videoCodec,
        merged.videoBitrateKbps,
        merged.gopFrames,
        merged.audioCodec,
        merged.audioSampleRateHz,
        merged.audioChannels,
        merged.audioBitrateKbps,
        merged.hwAccelMode,
        merged.activeEncoder,
        JSON.stringify(merged.cameraSequence || []),
        merged.cameraRepeat ? 1 : 0,
        merged.activeCameraIndex,
        merged.currentSourceId || null,
        JSON.stringify(merged.movieQueue || []),
        merged.movieRepeat ? 1 : 0,
        merged.activeMovieIndex,
        merged.currentMediaAssetId || null,
        merged.playbackPositionMs,
        merged.remainingDurationMs ?? null,
        merged.paused ? 1 : 0,
        JSON.stringify(merged.adSchedulePolicy || {}),
        JSON.stringify(merged.adState || {}),
        JSON.stringify(merged.graphicsConfig || {}),
        JSON.stringify(merged.fallbackConfig || {}),
        merged.fallbackActive ? 1 : 0,
        merged.emergencyActive ? 1 : 0,
        merged.emergencySourceId || null,
        JSON.stringify(merged.networkAllowlist || []),
        merged.outputUdpPort ?? null,
        merged.outputHlsEnabled ? 1 : 0,
        merged.outputSrtUrl || null,
        merged.workerSessionId || null,
        merged.workerPid ?? null,
        merged.restartCount,
        merged.lastHeartbeatAt || null,
        merged.lastOutputAt || null,
        merged.lastRecoveryAt || null,
        merged.lastError || null,
        merged.revision,
        merged.updatedByUserId || null,
        merged.createdAt,
        merged.updatedAt
      );

      if (actor) {
        insertAuditEvent(db, {
          organizationId,
          userId: actor.id,
          action: actor.auditAction || 'CHANNEL_PLAYOUT_CONFIG_UPDATED',
          resourceType: 'ChannelPlayoutConfig',
          resourceId: channelId,
          details: {
            channelId,
            playoutMode: merged.playoutMode,
            desiredState: merged.desiredState,
            runtimeState: merged.runtimeState,
            revision: merged.revision
          },
          ipAddress: actor.ipAddress
        });
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    return await this.getChannelConfig(channelId, organizationId);
  }

  async updateRuntimeCheckpoint(channelId, organizationId, checkpoint) {
    const current = await this.getChannelConfig(channelId, organizationId);
    const nowIso = new Date().toISOString();
    const merged = {
      ...current,
      ...checkpoint,
      updatedAt: nowIso
    };
    this.db.prepare(`
      INSERT INTO channel_playout_configs (
        channelId, organizationId, playoutMode, desiredState, runtimeState, autoStart,
        width, height, frameRate, videoCodec, videoBitrateKbps, gopFrames,
        audioCodec, audioSampleRateHz, audioChannels, audioBitrateKbps,
        hwAccelMode, activeEncoder,
        cameraSequence, cameraRepeat, activeCameraIndex, currentSourceId,
        movieQueue, movieRepeat, activeMovieIndex, currentMediaAssetId,
        playbackPositionMs, remainingDurationMs, paused,
        adSchedulePolicy, adState, graphicsConfig, fallbackConfig,
        fallbackActive, emergencyActive, emergencySourceId,
        networkAllowlist, outputUdpPort, outputHlsEnabled, outputSrtUrl,
        workerSessionId, workerPid, restartCount,
        lastHeartbeatAt, lastOutputAt, lastRecoveryAt, lastError,
        revision, updatedByUserId, createdAt, updatedAt
      ) VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?
      ) ON CONFLICT(channelId, organizationId) DO UPDATE SET
        desiredState = excluded.desiredState,
        runtimeState = excluded.runtimeState,
        activeEncoder = excluded.activeEncoder,
        activeCameraIndex = excluded.activeCameraIndex,
        currentSourceId = excluded.currentSourceId,
        activeMovieIndex = excluded.activeMovieIndex,
        currentMediaAssetId = excluded.currentMediaAssetId,
        playbackPositionMs = excluded.playbackPositionMs,
        remainingDurationMs = excluded.remainingDurationMs,
        paused = excluded.paused,
        adState = excluded.adState,
        fallbackActive = excluded.fallbackActive,
        emergencyActive = excluded.emergencyActive,
        emergencySourceId = excluded.emergencySourceId,
        workerSessionId = excluded.workerSessionId,
        workerPid = excluded.workerPid,
        restartCount = excluded.restartCount,
        lastHeartbeatAt = excluded.lastHeartbeatAt,
        lastOutputAt = excluded.lastOutputAt,
        lastRecoveryAt = excluded.lastRecoveryAt,
        lastError = excluded.lastError,
        updatedAt = excluded.updatedAt
    `).run(
      channelId,
      organizationId,
      merged.playoutMode,
      merged.desiredState,
      merged.runtimeState,
      merged.autoStart ? 1 : 0,
      merged.width,
      merged.height,
      merged.frameRate,
      merged.videoCodec,
      merged.videoBitrateKbps,
      merged.gopFrames,
      merged.audioCodec,
      merged.audioSampleRateHz,
      merged.audioChannels,
      merged.audioBitrateKbps,
      merged.hwAccelMode,
      merged.activeEncoder,
      JSON.stringify(merged.cameraSequence || []),
      merged.cameraRepeat ? 1 : 0,
      merged.activeCameraIndex,
      merged.currentSourceId || null,
      JSON.stringify(merged.movieQueue || []),
      merged.movieRepeat ? 1 : 0,
      merged.activeMovieIndex,
      merged.currentMediaAssetId || null,
      merged.playbackPositionMs,
      merged.remainingDurationMs ?? null,
      merged.paused ? 1 : 0,
      JSON.stringify(merged.adSchedulePolicy || {}),
      JSON.stringify(merged.adState || {}),
      JSON.stringify(merged.graphicsConfig || {}),
      JSON.stringify(merged.fallbackConfig || {}),
      merged.fallbackActive ? 1 : 0,
      merged.emergencyActive ? 1 : 0,
      merged.emergencySourceId || null,
      JSON.stringify(merged.networkAllowlist || []),
      merged.outputUdpPort ?? null,
      merged.outputHlsEnabled ? 1 : 0,
      merged.outputSrtUrl || null,
      merged.workerSessionId || null,
      merged.workerPid ?? null,
      merged.restartCount,
      merged.lastHeartbeatAt || null,
      merged.lastOutputAt || null,
      merged.lastRecoveryAt || null,
      merged.lastError || null,
      merged.revision,
      merged.updatedByUserId || null,
      merged.createdAt,
      merged.updatedAt
    );
    return await this.getChannelConfig(channelId, organizationId);
  }
}
