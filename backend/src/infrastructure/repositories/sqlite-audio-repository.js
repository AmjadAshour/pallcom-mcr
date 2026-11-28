import { randomUUID } from 'node:crypto';
import { IAudioRepository } from '@mcr/domain';
import { AUDIO_SOURCE_STATES } from '@mcr/shared';
import { getSqliteDatabase } from '../database/sqlite.js';
import { insertAuditEvent } from './sqlite-audit-repository.js';

export function defaultChannelMixerConfig(channelId, organizationId) {
  return {
    channelId,
    organizationId,
    masterVolumeLinear: 1.0,
    masterGainDb: 0.0,
    masterMuted: false,
    routingMode: 'MIX_VIDEO_AND_EXTERNAL_AUDIO',
    cameraAudioMuted: true,
    cameraAudioGainDb: -6.0,
    duckingEnabled: true,
    duckingThresholdDbfs: -32.0,
    duckingReductionDb: -12.0,
    duckingAttackMs: 120,
    duckingHoldMs: 300,
    duckingReleaseMs: 600,
    crossfadeDurationMs: 1500,
    adAudioPolicy: 'REPLACE_MUSIC_PAUSE_PLAYLIST',
    adActive: false,
    peakLimiterCeilingDbfs: -1.0,
    loudnessNormalization: false,
    targetLoudnessLufs: -23.0,
    silenceThresholdDbfs: -60.0,
    silenceTimeoutSeconds: 10,
    fallbackSourceId: null,
    fallbackAssetId: null,
    outputCodec: 'aac_lc',
    outputSampleRateHz: 48000,
    outputChannels: 2,
    outputBitrateKbps: 192,
    measuredMasterRmsDbfs: -90.0,
    measuredMasterPeakDbfs: -90.0,
    masterClippingPrevented: false,
    updatedByUserId: null,
    updatedAt: new Date().toISOString()
  };
}

export function mapAudioSourceRow(row, { includeEncryptedSecret = false } = {}) {
  if (!row) return null;
  const mapped = {
    id: row.id,
    organizationId: row.organizationId,
    channelId: row.channelId,
    name: row.name,
    description: row.description || '',
    sourceType: row.sourceType,
    mediaAssetId: row.mediaAssetId || null,
    playlistId: row.playlistId || null,
    videoSourceId: row.videoSourceId || null,
    obsInputName: row.obsInputName || null,
    streamUrl: row.streamUrl || null,
    hasSecret: Boolean(row.encryptedSecret),
    enabled: Boolean(row.enabled),
    muted: Boolean(row.muted),
    soloMonitoring: Boolean(row.soloMonitoring),
    volumeLinear: Number(row.volumeLinear ?? 1.0),
    gainDb: Number(row.gainDb ?? 0.0),
    delayMs: Number(row.delayMs ?? 0),
    fadeInMs: Number(row.fadeInMs ?? 500),
    fadeOutMs: Number(row.fadeOutMs ?? 500),
    priority: Number(row.priority ?? 50),
    duckingTrigger: Boolean(row.duckingTrigger),
    duckingTarget: Boolean(row.duckingTarget),
    repeatMode: row.repeatMode || 'REPEAT_PLAYLIST',
    shuffleEnabled: Boolean(row.shuffleEnabled),
    crossfadeMs: Number(row.crossfadeMs ?? 1500),
    currentTrackIndex: Number(row.currentTrackIndex ?? 0),
    currentTrackAssetId: row.currentTrackAssetId || null,
    playbackPositionMs: Number(row.playbackPositionMs ?? 0),
    remainingDurationMs: row.remainingDurationMs !== null && row.remainingDurationMs !== undefined
      ? Number(row.remainingDurationMs)
      : null,
    state: row.state || AUDIO_SOURCE_STATES.ONLINE,
    measuredRmsDbfs: Number(row.measuredRmsDbfs ?? -90.0),
    measuredPeakDbfs: Number(row.measuredPeakDbfs ?? -90.0),
    clippingDetected: Boolean(row.clippingDetected),
    codec: row.codec || null,
    sampleRateHz: row.sampleRateHz ? Number(row.sampleRateHz) : 48000,
    channels: row.channels ? Number(row.channels) : 2,
    streamMetadata: row.streamMetadata || null,
    reconnectEnabled: Boolean(row.reconnectEnabled),
    maxRetries: Number(row.maxRetries ?? 5),
    retryCount: Number(row.retryCount ?? 0),
    backoffBaseMs: Number(row.backoffBaseMs ?? 2000),
    backoffMaxMs: Number(row.backoffMaxMs ?? 30000),
    fallbackSourceId: row.fallbackSourceId || null,
    fallbackAssetId: row.fallbackAssetId || null,
    lastConnectedAt: row.lastConnectedAt ? new Date(row.lastConnectedAt).toISOString() : null,
    lastError: row.lastError || null,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt)
  };
  if (includeEncryptedSecret) mapped.encryptedSecret = row.encryptedSecret || null;
  return mapped;
}

export function mapMixerConfigRow(row) {
  if (!row) return null;
  return {
    channelId: row.channelId,
    organizationId: row.organizationId,
    masterVolumeLinear: Number(row.masterVolumeLinear ?? 1.0),
    masterGainDb: Number(row.masterGainDb ?? 0.0),
    masterMuted: Boolean(row.masterMuted),
    routingMode: row.routingMode || 'MIX_VIDEO_AND_EXTERNAL_AUDIO',
    cameraAudioMuted: Boolean(row.cameraAudioMuted),
    cameraAudioGainDb: Number(row.cameraAudioGainDb ?? -6.0),
    duckingEnabled: Boolean(row.duckingEnabled),
    duckingThresholdDbfs: Number(row.duckingThresholdDbfs ?? -32.0),
    duckingReductionDb: Number(row.duckingReductionDb ?? -12.0),
    duckingAttackMs: Number(row.duckingAttackMs ?? 120),
    duckingHoldMs: Number(row.duckingHoldMs ?? 300),
    duckingReleaseMs: Number(row.duckingReleaseMs ?? 600),
    crossfadeDurationMs: Number(row.crossfadeDurationMs ?? 1500),
    adAudioPolicy: row.adAudioPolicy || 'REPLACE_MUSIC_PAUSE_PLAYLIST',
    adActive: Boolean(row.adActive),
    peakLimiterCeilingDbfs: Number(row.peakLimiterCeilingDbfs ?? -1.0),
    loudnessNormalization: Boolean(row.loudnessNormalization),
    targetLoudnessLufs: Number(row.targetLoudnessLufs ?? -23.0),
    silenceThresholdDbfs: Number(row.silenceThresholdDbfs ?? -60.0),
    silenceTimeoutSeconds: Number(row.silenceTimeoutSeconds ?? 10),
    fallbackSourceId: row.fallbackSourceId || null,
    fallbackAssetId: row.fallbackAssetId || null,
    outputCodec: row.outputCodec || 'aac_lc',
    outputSampleRateHz: Number(row.outputSampleRateHz ?? 48000),
    outputChannels: Number(row.outputChannels ?? 2),
    outputBitrateKbps: Number(row.outputBitrateKbps ?? 192),
    measuredMasterRmsDbfs: Number(row.measuredMasterRmsDbfs ?? -90.0),
    measuredMasterPeakDbfs: Number(row.measuredMasterPeakDbfs ?? -90.0),
    masterClippingPrevented: Boolean(row.masterClippingPrevented),
    updatedByUserId: row.updatedByUserId || null,
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt)
  };
}

export class SqliteAudioRepository extends IAudioRepository {
  get db() {
    return getSqliteDatabase();
  }

  async createAudioSource(source, actor) {
    const db = this.db;
    const id = source.id || randomUUID();
    const nowIso = new Date().toISOString();
    const enabled = source.enabled !== undefined ? Boolean(source.enabled) : true;
    const state = !enabled
      ? AUDIO_SOURCE_STATES.DISABLED
      : source.state || (source.sourceType === 'MICROPHONE_INPUT' ? AUDIO_SOURCE_STATES.PAUSED : AUDIO_SOURCE_STATES.ONLINE);

    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(`
        INSERT INTO audio_sources (
          id, organizationId, channelId, name, description, sourceType,
          mediaAssetId, playlistId, videoSourceId, obsInputName, streamUrl, encryptedSecret,
          enabled, muted, soloMonitoring, volumeLinear, gainDb, delayMs, fadeInMs, fadeOutMs,
          priority, duckingTrigger, duckingTarget, repeatMode, shuffleEnabled, crossfadeMs,
          currentTrackIndex, currentTrackAssetId, playbackPositionMs, remainingDurationMs,
          state, measuredRmsDbfs, measuredPeakDbfs, clippingDetected,
          codec, sampleRateHz, channels, streamMetadata,
          reconnectEnabled, maxRetries, retryCount, backoffBaseMs, backoffMaxMs,
          fallbackSourceId, fallbackAssetId, lastConnectedAt, lastError,
          createdByUserId, createdAt, updatedAt
        ) VALUES (
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, 0, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?
        )
      `).run(
        id,
        source.organizationId,
        source.channelId,
        source.name,
        source.description || '',
        source.sourceType,
        source.mediaAssetId || null,
        source.playlistId || null,
        source.videoSourceId || null,
        source.obsInputName || null,
        source.streamUrl || null,
        source.encryptedSecret || null,
        enabled ? 1 : 0,
        source.muted ? 1 : 0,
        source.soloMonitoring ? 1 : 0,
        source.volumeLinear ?? 1.0,
        source.gainDb ?? 0.0,
        source.delayMs ?? 0,
        source.fadeInMs ?? 500,
        source.fadeOutMs ?? 500,
        source.priority ?? 50,
        source.duckingTrigger ? 1 : 0,
        source.duckingTarget !== undefined ? (source.duckingTarget ? 1 : 0) : 1,
        source.repeatMode || 'REPEAT_PLAYLIST',
        source.shuffleEnabled ? 1 : 0,
        source.crossfadeMs ?? 1500,
        source.currentTrackIndex ?? 0,
        source.currentTrackAssetId || null,
        source.playbackPositionMs ?? 0,
        source.remainingDurationMs ?? null,
        state,
        source.measuredRmsDbfs ?? -90.0,
        source.measuredPeakDbfs ?? -90.0,
        source.clippingDetected ? 1 : 0,
        source.codec || 'aac',
        source.sampleRateHz ?? 48000,
        source.channels ?? 2,
        source.streamMetadata || null,
        source.reconnectEnabled !== undefined ? (source.reconnectEnabled ? 1 : 0) : 1,
        source.maxRetries ?? 5,
        source.backoffBaseMs ?? 2000,
        source.backoffMaxMs ?? 30000,
        source.fallbackSourceId || null,
        source.fallbackAssetId || null,
        source.lastConnectedAt || null,
        source.lastError || null,
        source.createdByUserId,
        nowIso,
        nowIso
      );
      if (actor) {
        insertAuditEvent(db, {
          organizationId: source.organizationId,
          userId: actor.id,
          action: 'AUDIO_SOURCE_CREATED',
          resourceType: 'AudioSource',
          resourceId: id,
          details: { channelId: source.channelId, sourceType: source.sourceType, name: source.name },
          ipAddress: actor.ipAddress
        });
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    return await this.findAudioSourceById(id, source.organizationId);
  }

  async updateAudioSource(id, organizationId, updates, actor) {
    const db = this.db;
    const existing = db.prepare('SELECT * FROM audio_sources WHERE id = ? AND organizationId = ?').get(id, organizationId);
    if (!existing) return null;
    const nowIso = new Date().toISOString();
    const enabled = updates.enabled !== undefined ? Boolean(updates.enabled) : Boolean(existing.enabled);
    const nextState = !enabled
      ? AUDIO_SOURCE_STATES.DISABLED
      : (updates.state ?? (existing.state === AUDIO_SOURCE_STATES.DISABLED ? AUDIO_SOURCE_STATES.ONLINE : existing.state));

    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(`
        UPDATE audio_sources SET
          name = ?, description = ?, streamUrl = ?, encryptedSecret = ?,
          mediaAssetId = ?, playlistId = ?, videoSourceId = ?, obsInputName = ?,
          enabled = ?, muted = ?, soloMonitoring = ?, volumeLinear = ?, gainDb = ?,
          delayMs = ?, fadeInMs = ?, fadeOutMs = ?, priority = ?,
          duckingTrigger = ?, duckingTarget = ?, repeatMode = ?, shuffleEnabled = ?, crossfadeMs = ?,
          state = ?, reconnectEnabled = ?, maxRetries = ?, backoffBaseMs = ?, backoffMaxMs = ?,
          fallbackSourceId = ?, fallbackAssetId = ?, updatedAt = ?
        WHERE id = ? AND organizationId = ?
      `).run(
        updates.name ?? existing.name,
        updates.description ?? existing.description,
        updates.streamUrl !== undefined ? updates.streamUrl : existing.streamUrl,
        updates.encryptedSecret !== undefined ? updates.encryptedSecret : existing.encryptedSecret,
        updates.mediaAssetId !== undefined ? updates.mediaAssetId : existing.mediaAssetId,
        updates.playlistId !== undefined ? updates.playlistId : existing.playlistId,
        updates.videoSourceId !== undefined ? updates.videoSourceId : existing.videoSourceId,
        updates.obsInputName !== undefined ? updates.obsInputName : existing.obsInputName,
        enabled ? 1 : 0,
        (updates.muted !== undefined ? updates.muted : Boolean(existing.muted)) ? 1 : 0,
        (updates.soloMonitoring !== undefined ? updates.soloMonitoring : Boolean(existing.soloMonitoring)) ? 1 : 0,
        updates.volumeLinear ?? existing.volumeLinear,
        updates.gainDb ?? existing.gainDb,
        updates.delayMs ?? existing.delayMs,
        updates.fadeInMs ?? existing.fadeInMs,
        updates.fadeOutMs ?? existing.fadeOutMs,
        updates.priority ?? existing.priority,
        (updates.duckingTrigger !== undefined ? updates.duckingTrigger : Boolean(existing.duckingTrigger)) ? 1 : 0,
        (updates.duckingTarget !== undefined ? updates.duckingTarget : Boolean(existing.duckingTarget)) ? 1 : 0,
        updates.repeatMode ?? existing.repeatMode,
        (updates.shuffleEnabled !== undefined ? updates.shuffleEnabled : Boolean(existing.shuffleEnabled)) ? 1 : 0,
        updates.crossfadeMs ?? existing.crossfadeMs,
        nextState,
        (updates.reconnectEnabled !== undefined ? updates.reconnectEnabled : Boolean(existing.reconnectEnabled)) ? 1 : 0,
        updates.maxRetries ?? existing.maxRetries,
        updates.backoffBaseMs ?? existing.backoffBaseMs,
        updates.backoffMaxMs ?? existing.backoffMaxMs,
        updates.fallbackSourceId !== undefined ? updates.fallbackSourceId : existing.fallbackSourceId,
        updates.fallbackAssetId !== undefined ? updates.fallbackAssetId : existing.fallbackAssetId,
        nowIso,
        id,
        organizationId
      );
      if (actor) {
        insertAuditEvent(db, {
          organizationId,
          userId: actor.id,
          action: 'AUDIO_SOURCE_UPDATED',
          resourceType: 'AudioSource',
          resourceId: id,
          details: { channelId: existing.channelId, updatedFields: Object.keys(updates) },
          ipAddress: actor.ipAddress
        });
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    return await this.findAudioSourceById(id, organizationId);
  }

  async updateAudioSourceRuntimeState(id, organizationId, runtime) {
    const db = this.db;
    const existing = db.prepare('SELECT * FROM audio_sources WHERE id = ? AND organizationId = ?').get(id, organizationId);
    if (!existing) return null;
    const nowIso = new Date().toISOString();
    db.prepare(`
      UPDATE audio_sources SET
        state = ?, measuredRmsDbfs = ?, measuredPeakDbfs = ?, clippingDetected = ?,
        currentTrackIndex = ?, currentTrackAssetId = ?, playbackPositionMs = ?, remainingDurationMs = ?,
        codec = ?, sampleRateHz = ?, channels = ?, streamMetadata = ?,
        retryCount = ?, lastConnectedAt = ?, lastError = ?, updatedAt = ?
      WHERE id = ? AND organizationId = ?
    `).run(
      runtime.state ?? existing.state,
      runtime.measuredRmsDbfs ?? existing.measuredRmsDbfs,
      runtime.measuredPeakDbfs ?? existing.measuredPeakDbfs,
      (runtime.clippingDetected !== undefined ? runtime.clippingDetected : Boolean(existing.clippingDetected)) ? 1 : 0,
      runtime.currentTrackIndex ?? existing.currentTrackIndex,
      runtime.currentTrackAssetId !== undefined ? runtime.currentTrackAssetId : existing.currentTrackAssetId,
      runtime.playbackPositionMs ?? existing.playbackPositionMs,
      runtime.remainingDurationMs !== undefined ? runtime.remainingDurationMs : existing.remainingDurationMs,
      runtime.codec !== undefined ? runtime.codec : existing.codec,
      runtime.sampleRateHz ?? existing.sampleRateHz,
      runtime.channels ?? existing.channels,
      runtime.streamMetadata !== undefined ? runtime.streamMetadata : existing.streamMetadata,
      runtime.retryCount ?? existing.retryCount,
      runtime.lastConnectedAt !== undefined ? runtime.lastConnectedAt : existing.lastConnectedAt,
      runtime.lastError !== undefined ? runtime.lastError : existing.lastError,
      nowIso,
      id,
      organizationId
    );
    return await this.findAudioSourceById(id, organizationId);
  }

  async findAudioSourceById(id, organizationId, options = {}) {
    const row = this.db.prepare('SELECT * FROM audio_sources WHERE id = ? AND organizationId = ?').get(id, organizationId);
    return mapAudioSourceRow(row, options);
  }

  async listAudioSources(organizationId, { channelId = '', sourceType = '', state = '' } = {}) {
    const clauses = ['organizationId = ?'];
    const params = [organizationId];
    if (channelId) {
      clauses.push('channelId = ?');
      params.push(channelId);
    }
    if (sourceType) {
      clauses.push('sourceType = ?');
      params.push(sourceType);
    }
    if (state) {
      clauses.push('state = ?');
      params.push(state);
    }
    const rows = this.db.prepare(
      `SELECT * FROM audio_sources WHERE ${clauses.join(' AND ')} ORDER BY priority DESC, createdAt ASC`
    ).all(...params);
    return rows.map(r => mapAudioSourceRow(r));
  }

  async deleteAudioSource(id, organizationId, actor) {
    const db = this.db;
    const existing = await this.findAudioSourceById(id, organizationId);
    if (!existing) return null;
    const fallbackRef = db.prepare(
      'SELECT COUNT(*) AS count FROM audio_sources WHERE organizationId = ? AND fallbackSourceId = ?'
    ).get(organizationId, id);
    const mixerFallbackRef = db.prepare(
      'SELECT COUNT(*) AS count FROM audio_mixer_configs WHERE organizationId = ? AND fallbackSourceId = ?'
    ).get(organizationId, id);
    if (Number(fallbackRef?.count ?? 0) > 0 || Number(mixerFallbackRef?.count ?? 0) > 0) {
      throw Object.assign(
        new Error('Cannot delete an audio source while it is configured as a fallback audio source'),
        { statusCode: 409 }
      );
    }
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('DELETE FROM audio_sources WHERE id = ? AND organizationId = ?').run(id, organizationId);
      if (actor) {
        insertAuditEvent(db, {
          organizationId,
          userId: actor.id,
          action: 'AUDIO_SOURCE_DELETED',
          resourceType: 'AudioSource',
          resourceId: id,
          details: { channelId: existing.channelId, name: existing.name, sourceType: existing.sourceType },
          ipAddress: actor.ipAddress
        });
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    return existing;
  }

  async getChannelMixerConfig(channelId, organizationId) {
    const row = this.db.prepare(
      'SELECT * FROM audio_mixer_configs WHERE channelId = ? AND organizationId = ?'
    ).get(channelId, organizationId);
    if (row) return mapMixerConfigRow(row);
    return defaultChannelMixerConfig(channelId, organizationId);
  }

  async saveChannelMixerConfig(channelId, organizationId, updates, actor) {
    const db = this.db;
    const current = await this.getChannelMixerConfig(channelId, organizationId);
    const merged = {
      ...current,
      ...updates,
      channelId,
      organizationId,
      updatedByUserId: actor?.id || current.updatedByUserId,
      updatedAt: new Date().toISOString()
    };

    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(`
        INSERT INTO audio_mixer_configs (
          channelId, organizationId, masterVolumeLinear, masterGainDb, masterMuted,
          routingMode, cameraAudioMuted, cameraAudioGainDb,
          duckingEnabled, duckingThresholdDbfs, duckingReductionDb, duckingAttackMs, duckingHoldMs, duckingReleaseMs,
          crossfadeDurationMs, adAudioPolicy, adActive,
          peakLimiterCeilingDbfs, loudnessNormalization, targetLoudnessLufs,
          silenceThresholdDbfs, silenceTimeoutSeconds, fallbackSourceId, fallbackAssetId,
          outputCodec, outputSampleRateHz, outputChannels, outputBitrateKbps,
          measuredMasterRmsDbfs, measuredMasterPeakDbfs, masterClippingPrevented,
          updatedByUserId, updatedAt
        ) VALUES (
          ?, ?, ?, ?, ?,
          ?, ?, ?,
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?,
          ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?,
          ?, ?
        ) ON CONFLICT(channelId, organizationId) DO UPDATE SET
          masterVolumeLinear = excluded.masterVolumeLinear,
          masterGainDb = excluded.masterGainDb,
          masterMuted = excluded.masterMuted,
          routingMode = excluded.routingMode,
          cameraAudioMuted = excluded.cameraAudioMuted,
          cameraAudioGainDb = excluded.cameraAudioGainDb,
          duckingEnabled = excluded.duckingEnabled,
          duckingThresholdDbfs = excluded.duckingThresholdDbfs,
          duckingReductionDb = excluded.duckingReductionDb,
          duckingAttackMs = excluded.duckingAttackMs,
          duckingHoldMs = excluded.duckingHoldMs,
          duckingReleaseMs = excluded.duckingReleaseMs,
          crossfadeDurationMs = excluded.crossfadeDurationMs,
          adAudioPolicy = excluded.adAudioPolicy,
          adActive = excluded.adActive,
          peakLimiterCeilingDbfs = excluded.peakLimiterCeilingDbfs,
          loudnessNormalization = excluded.loudnessNormalization,
          targetLoudnessLufs = excluded.targetLoudnessLufs,
          silenceThresholdDbfs = excluded.silenceThresholdDbfs,
          silenceTimeoutSeconds = excluded.silenceTimeoutSeconds,
          fallbackSourceId = excluded.fallbackSourceId,
          fallbackAssetId = excluded.fallbackAssetId,
          outputCodec = excluded.outputCodec,
          outputSampleRateHz = excluded.outputSampleRateHz,
          outputChannels = excluded.outputChannels,
          outputBitrateKbps = excluded.outputBitrateKbps,
          measuredMasterRmsDbfs = excluded.measuredMasterRmsDbfs,
          measuredMasterPeakDbfs = excluded.measuredMasterPeakDbfs,
          masterClippingPrevented = excluded.masterClippingPrevented,
          updatedByUserId = excluded.updatedByUserId,
          updatedAt = excluded.updatedAt
      `).run(
        channelId,
        organizationId,
        merged.masterVolumeLinear,
        merged.masterGainDb,
        merged.masterMuted ? 1 : 0,
        merged.routingMode,
        merged.cameraAudioMuted ? 1 : 0,
        merged.cameraAudioGainDb,
        merged.duckingEnabled ? 1 : 0,
        merged.duckingThresholdDbfs,
        merged.duckingReductionDb,
        merged.duckingAttackMs,
        merged.duckingHoldMs,
        merged.duckingReleaseMs,
        merged.crossfadeDurationMs,
        merged.adAudioPolicy,
        merged.adActive ? 1 : 0,
        merged.peakLimiterCeilingDbfs,
        merged.loudnessNormalization ? 1 : 0,
        merged.targetLoudnessLufs,
        merged.silenceThresholdDbfs,
        merged.silenceTimeoutSeconds,
        merged.fallbackSourceId || null,
        merged.fallbackAssetId || null,
        merged.outputCodec,
        merged.outputSampleRateHz,
        merged.outputChannels,
        merged.outputBitrateKbps,
        merged.measuredMasterRmsDbfs,
        merged.measuredMasterPeakDbfs,
        merged.masterClippingPrevented ? 1 : 0,
        merged.updatedByUserId,
        merged.updatedAt
      );
      if (actor) {
        insertAuditEvent(db, {
          organizationId,
          userId: actor.id,
          action: 'AUDIO_MIXER_CONFIG_UPDATED',
          resourceType: 'AudioMixerConfig',
          resourceId: channelId,
          details: { channelId, routingMode: merged.routingMode, masterMuted: merged.masterMuted },
          ipAddress: actor.ipAddress
        });
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    return await this.getChannelMixerConfig(channelId, organizationId);
  }
}
