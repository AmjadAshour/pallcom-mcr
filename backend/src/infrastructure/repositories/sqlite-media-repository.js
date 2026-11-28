import { randomUUID } from 'node:crypto';
import { IMediaRepository } from '@mcr/domain';
import { MEDIA_BROADCAST_COMPATIBILITY, MEDIA_PROCESSING_STATUS, MEDIA_UPLOAD_STATUS } from '@mcr/shared';
import { env } from '../../config/env.js';
import { getSqliteDatabase } from '../database/sqlite.js';
import { usesLocalSceneAsset } from '../program/supervisor.js';
import { insertAuditEvent } from './sqlite-audit-repository.js';

function parseJsonArray(raw) {
  try {
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function mapAssetRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    organizationId: row.organizationId,
    folder: row.folder || '',
    title: row.title,
    description: row.description || '',
    category: row.category,
    kind: row.kind,
    tags: parseJsonArray(row.tags),
    channelIds: parseJsonArray(row.channelIds),
    originalFilename: row.originalFilename,
    storageKey: row.storageKey,
    thumbnailKey: row.thumbnailKey || null,
    previewKey: row.previewKey || null,
    sizeBytes: Number(row.sizeBytes),
    checksumSha256: row.checksumSha256,
    mimeType: row.mimeType,
    containerFormat: row.containerFormat || null,
    videoCodec: row.videoCodec || null,
    audioCodec: row.audioCodec || null,
    width: row.width ?? null,
    height: row.height ?? null,
    frameRate: row.frameRate ?? null,
    durationSeconds: row.durationSeconds ?? null,
    bitrateBps: row.bitrateBps ?? null,
    audioChannels: row.audioChannels ?? null,
    sampleRateHz: row.sampleRateHz ?? null,
    hasVideo: Boolean(row.hasVideo),
    hasAudio: Boolean(row.hasAudio),
    uploadStatus: row.uploadStatus,
    processingStatus: row.processingStatus,
    broadcastCompatibility: row.broadcastCompatibility,
    compatibilityNotes: parseJsonArray(row.compatibilityNotes),
    errorReason: row.errorReason || null,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function mapUploadSessionRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    organizationId: row.organizationId,
    createdByUserId: row.createdByUserId,
    title: row.title,
    description: row.description || '',
    folder: row.folder || '',
    category: row.category,
    tags: parseJsonArray(row.tags),
    channelIds: parseJsonArray(row.channelIds),
    originalFilename: row.originalFilename,
    declaredMimeType: row.declaredMimeType || '',
    expectedSizeBytes: Number(row.expectedSizeBytes),
    expectedChecksumSha256: row.expectedChecksumSha256 || null,
    receivedBytes: Number(row.receivedBytes),
    chunkSizeBytes: Number(row.chunkSizeBytes),
    uploadKey: row.uploadKey,
    status: row.status,
    assetId: row.assetId || null,
    errorReason: row.errorReason || null,
    expiresAt: Number(row.expiresAt),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function mapPlaylistRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    description: row.description || '',
    kind: row.kind,
    channelId: row.channelId || null,
    items: parseJsonArray(row.items),
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

export class SqliteMediaRepository extends IMediaRepository {
  get db() {
    return getSqliteDatabase();
  }

  _computeUsageSync(organizationId, nowMs = Date.now()) {
    const stored = this.db.prepare(
      'SELECT COALESCE(SUM(sizeBytes), 0) AS bytes, COUNT(*) AS count FROM media_assets WHERE organizationId = ?'
    ).get(organizationId);
    const reserved = this.db.prepare(
      "SELECT COALESCE(SUM(expectedSizeBytes), 0) AS bytes, COUNT(*) AS count FROM media_upload_sessions WHERE organizationId = ? AND status = 'UPLOADING' AND expiresAt > ?"
    ).get(organizationId, nowMs);
    const storedBytes = Number(stored?.bytes ?? 0);
    const reservedUploadBytes = Number(reserved?.bytes ?? 0);
    const quotaBytes = env.MEDIA_ORG_QUOTA_BYTES;
    return {
      storedBytes,
      assetCount: Number(stored?.count ?? 0),
      reservedUploadBytes,
      activeUploadSessions: Number(reserved?.count ?? 0),
      totalCommittedBytes: storedBytes + reservedUploadBytes,
      quotaBytes,
      remainingQuotaBytes: Math.max(0, quotaBytes - (storedBytes + reservedUploadBytes))
    };
  }

  async getStorageUsage(organizationId) {
    return this._computeUsageSync(organizationId);
  }

  async createUploadSession(session, actor) {
    const db = this.db;
    const nowIso = new Date().toISOString();
    const nowMs = Date.now();
    const id = session.id || randomUUID();
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare("UPDATE media_upload_sessions SET status = 'EXPIRED', updatedAt = ? WHERE status = 'UPLOADING' AND expiresAt <= ?")
        .run(nowIso, nowMs);
      const usage = this._computeUsageSync(session.organizationId, nowMs);
      if (usage.totalCommittedBytes + session.expectedSizeBytes > usage.quotaBytes) {
        throw Object.assign(new Error('This upload exceeds the organization media storage quota'), { statusCode: 409 });
      }
      db.prepare(`
        INSERT INTO media_upload_sessions (
          id, organizationId, createdByUserId, title, description, folder, category, tags, channelIds,
          originalFilename, declaredMimeType, expectedSizeBytes, expectedChecksumSha256, receivedBytes,
          chunkSizeBytes, uploadKey, status, assetId, errorReason, expiresAt, createdAt, updatedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, NULL, NULL, ?, ?, ?)
      `).run(
        id,
        session.organizationId,
        session.createdByUserId,
        session.title,
        session.description || '',
        session.folder || '',
        session.category,
        JSON.stringify(session.tags || []),
        JSON.stringify(session.channelIds || []),
        session.originalFilename,
        session.declaredMimeType || '',
        session.expectedSizeBytes,
        session.expectedChecksumSha256 || null,
        session.chunkSizeBytes,
        session.uploadKey,
        MEDIA_UPLOAD_STATUS.UPLOADING,
        session.expiresAt,
        nowIso,
        nowIso
      );
      if (actor) {
        insertAuditEvent(db, {
          organizationId: session.organizationId,
          userId: actor.id,
          action: 'MEDIA_UPLOAD_INITIATED',
          resourceType: 'MediaUploadSession',
          resourceId: id,
          details: {
            category: session.category,
            expectedSizeBytes: session.expectedSizeBytes
          },
          ipAddress: actor.ipAddress
        });
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    return await this.findUploadSession(id, session.organizationId);
  }

  async findUploadSession(id, organizationId) {
    const row = this.db.prepare(
      'SELECT * FROM media_upload_sessions WHERE id = ? AND organizationId = ?'
    ).get(id, organizationId);
    return mapUploadSessionRow(row);
  }

  async listUploadSessions(organizationId, { status } = {}) {
    const rows = status
      ? this.db.prepare('SELECT * FROM media_upload_sessions WHERE organizationId = ? AND status = ? ORDER BY createdAt DESC LIMIT 100')
        .all(organizationId, status)
      : this.db.prepare('SELECT * FROM media_upload_sessions WHERE organizationId = ? ORDER BY createdAt DESC LIMIT 100')
        .all(organizationId);
    return rows.map(mapUploadSessionRow);
  }

  async updateUploadSessionProgress(id, organizationId, { receivedBytes, status, assetId, errorReason }) {
    const nowIso = new Date().toISOString();
    const existing = await this.findUploadSession(id, organizationId);
    if (!existing) return null;
    this.db.prepare(`
      UPDATE media_upload_sessions
      SET receivedBytes = ?, status = ?, assetId = ?, errorReason = ?, updatedAt = ?
      WHERE id = ? AND organizationId = ?
    `).run(
      receivedBytes ?? existing.receivedBytes,
      status ?? existing.status,
      assetId !== undefined ? assetId : existing.assetId,
      errorReason !== undefined ? errorReason : existing.errorReason,
      nowIso,
      id,
      organizationId
    );
    return await this.findUploadSession(id, organizationId);
  }

  async cancelUploadSession(id, organizationId, actor) {
    const db = this.db;
    const nowIso = new Date().toISOString();
    db.exec('BEGIN IMMEDIATE');
    let row;
    try {
      row = db.prepare('SELECT * FROM media_upload_sessions WHERE id = ? AND organizationId = ?').get(id, organizationId);
      if (!row) {
        db.exec('ROLLBACK');
        return null;
      }
      if (row.status === MEDIA_UPLOAD_STATUS.UPLOADED) {
        throw Object.assign(new Error('Completed upload session cannot be cancelled'), { statusCode: 409 });
      }
      db.prepare("UPDATE media_upload_sessions SET status = 'CANCELLED', updatedAt = ? WHERE id = ? AND organizationId = ?")
        .run(nowIso, id, organizationId);
      if (actor) {
        insertAuditEvent(db, {
          organizationId,
          userId: actor.id,
          action: 'MEDIA_UPLOAD_CANCELLED',
          resourceType: 'MediaUploadSession',
          resourceId: id,
          details: { receivedBytes: Number(row.receivedBytes) },
          ipAddress: actor.ipAddress
        });
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    return mapUploadSessionRow({ ...row, status: MEDIA_UPLOAD_STATUS.CANCELLED, updatedAt: nowIso });
  }

  async expireAbandonedUploads(nowMs = Date.now()) {
    const db = this.db;
    const nowIso = new Date().toISOString();
    const expired = db.prepare(
      "SELECT * FROM media_upload_sessions WHERE status = 'UPLOADING' AND expiresAt <= ?"
    ).all(nowMs).map(mapUploadSessionRow);
    if (expired.length) {
      db.prepare(
        "UPDATE media_upload_sessions SET status = 'EXPIRED', updatedAt = ? WHERE status = 'UPLOADING' AND expiresAt <= ?"
      ).run(nowIso, nowMs);
    }
    return expired;
  }

  async createAsset(asset, actor, { sessionId = null, checkQuota = true } = {}) {
    const db = this.db;
    const id = asset.id || randomUUID();
    const jobId = randomUUID();
    const nowIso = new Date().toISOString();
    db.exec('BEGIN IMMEDIATE');
    try {
      if (checkQuota) {
        const usage = this._computeUsageSync(asset.organizationId);
        if (usage.totalCommittedBytes + asset.sizeBytes > usage.quotaBytes) {
          throw Object.assign(new Error('This media file exceeds the organization media storage quota'), { statusCode: 409 });
        }
      }
      db.prepare(`
        INSERT INTO media_assets (
          id, organizationId, folder, title, description, category, kind, tags, channelIds,
          originalFilename, storageKey, thumbnailKey, previewKey, sizeBytes, checksumSha256,
          mimeType, containerFormat, videoCodec, audioCodec, width, height, frameRate,
          durationSeconds, bitrateBps, audioChannels, sampleRateHz, hasVideo, hasAudio,
          uploadStatus, processingStatus, broadcastCompatibility, compatibilityNotes,
          errorReason, createdByUserId, createdAt, updatedAt
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?
        )
      `).run(
        id,
        asset.organizationId,
        asset.folder || '',
        asset.title,
        asset.description || '',
        asset.category,
        asset.kind || 'VIDEO',
        JSON.stringify(asset.tags || []),
        JSON.stringify(asset.channelIds || []),
        asset.originalFilename,
        asset.storageKey,
        asset.thumbnailKey || null,
        asset.previewKey || null,
        asset.sizeBytes,
        asset.checksumSha256,
        asset.mimeType || 'application/octet-stream',
        asset.containerFormat || null,
        asset.videoCodec || null,
        asset.audioCodec || null,
        asset.width ?? null,
        asset.height ?? null,
        asset.frameRate ?? null,
        asset.durationSeconds ?? null,
        asset.bitrateBps ?? null,
        asset.audioChannels ?? null,
        asset.sampleRateHz ?? null,
        asset.hasVideo ? 1 : 0,
        asset.hasAudio ? 1 : 0,
        asset.uploadStatus || MEDIA_UPLOAD_STATUS.UPLOADED,
        asset.processingStatus || MEDIA_PROCESSING_STATUS.VALIDATING,
        asset.broadcastCompatibility || MEDIA_BROADCAST_COMPATIBILITY.PENDING,
        JSON.stringify(asset.compatibilityNotes || []),
        asset.errorReason || null,
        asset.createdByUserId,
        nowIso,
        nowIso
      );
      if (sessionId) {
        db.prepare(`
          UPDATE media_upload_sessions
          SET status = 'UPLOADED', receivedBytes = expectedSizeBytes, assetId = ?, updatedAt = ?
          WHERE id = ? AND organizationId = ?
        `).run(id, nowIso, sessionId, asset.organizationId);
      }
      db.prepare(`
        INSERT INTO media_processing_jobs (
          id, assetId, organizationId, jobType, status, attempts, errorReason, startedAt, completedAt, createdAt, updatedAt
        ) VALUES (?, ?, ?, 'VALIDATE_AND_INSPECT', 'PENDING', 0, NULL, NULL, NULL, ?, ?)
      `).run(jobId, id, asset.organizationId, nowIso, nowIso);
      if (actor) {
        insertAuditEvent(db, {
          organizationId: asset.organizationId,
          userId: actor.id,
          action: asset.auditAction || 'MEDIA_ASSET_CREATED',
          resourceType: 'MediaAsset',
          resourceId: id,
          details: {
            category: asset.category,
            sizeBytes: asset.sizeBytes,
            checksumSha256: asset.checksumSha256,
            source: asset.importSource || 'upload'
          },
          ipAddress: actor.ipAddress
        });
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    return await this.findAssetById(id, asset.organizationId);
  }

  async updateAssetProcessing(id, organizationId, updates) {
    const db = this.db;
    const existing = await this.findAssetById(id, organizationId);
    if (!existing) return null;
    const nowIso = new Date().toISOString();
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(`
        UPDATE media_assets SET
          kind = ?,
          storageKey = ?,
          thumbnailKey = ?,
          previewKey = ?,
          mimeType = ?,
          containerFormat = ?,
          videoCodec = ?,
          audioCodec = ?,
          width = ?,
          height = ?,
          frameRate = ?,
          durationSeconds = ?,
          bitrateBps = ?,
          audioChannels = ?,
          sampleRateHz = ?,
          hasVideo = ?,
          hasAudio = ?,
          processingStatus = ?,
          broadcastCompatibility = ?,
          compatibilityNotes = ?,
          errorReason = ?,
          updatedAt = ?
        WHERE id = ? AND organizationId = ?
      `).run(
        updates.kind ?? existing.kind,
        updates.storageKey ?? existing.storageKey,
        updates.thumbnailKey !== undefined ? updates.thumbnailKey : existing.thumbnailKey,
        updates.previewKey !== undefined ? updates.previewKey : existing.previewKey,
        updates.mimeType ?? existing.mimeType,
        updates.containerFormat !== undefined ? updates.containerFormat : existing.containerFormat,
        updates.videoCodec !== undefined ? updates.videoCodec : existing.videoCodec,
        updates.audioCodec !== undefined ? updates.audioCodec : existing.audioCodec,
        updates.width !== undefined ? updates.width : existing.width,
        updates.height !== undefined ? updates.height : existing.height,
        updates.frameRate !== undefined ? updates.frameRate : existing.frameRate,
        updates.durationSeconds !== undefined ? updates.durationSeconds : existing.durationSeconds,
        updates.bitrateBps !== undefined ? updates.bitrateBps : existing.bitrateBps,
        updates.audioChannels !== undefined ? updates.audioChannels : existing.audioChannels,
        updates.sampleRateHz !== undefined ? updates.sampleRateHz : existing.sampleRateHz,
        (updates.hasVideo ?? existing.hasVideo) ? 1 : 0,
        (updates.hasAudio ?? existing.hasAudio) ? 1 : 0,
        updates.processingStatus ?? existing.processingStatus,
        updates.broadcastCompatibility ?? existing.broadcastCompatibility,
        JSON.stringify(updates.compatibilityNotes ?? existing.compatibilityNotes),
        updates.errorReason !== undefined ? updates.errorReason : existing.errorReason,
        nowIso,
        id,
        organizationId
      );
      if (updates.jobStatus) {
        db.prepare(`
          UPDATE media_processing_jobs
          SET status = ?, attempts = attempts + 1, errorReason = ?, completedAt = ?, updatedAt = ?
          WHERE assetId = ? AND organizationId = ?
        `).run(
          updates.jobStatus,
          updates.errorReason ?? null,
          ['READY', 'FAILED', 'QUARANTINED'].includes(updates.jobStatus) ? nowIso : null,
          nowIso,
          id,
          organizationId
        );
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    return await this.findAssetById(id, organizationId);
  }

  async updateAssetMetadata(id, organizationId, updates, actor) {
    const db = this.db;
    const existing = await this.findAssetById(id, organizationId);
    if (!existing) return null;
    const nowIso = new Date().toISOString();
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(`
        UPDATE media_assets SET
          title = ?, description = ?, folder = ?, category = ?, tags = ?, channelIds = ?, updatedAt = ?
        WHERE id = ? AND organizationId = ?
      `).run(
        updates.title ?? existing.title,
        updates.description ?? existing.description,
        updates.folder ?? existing.folder,
        updates.category ?? existing.category,
        JSON.stringify(updates.tags ?? existing.tags),
        JSON.stringify(updates.channelIds ?? existing.channelIds),
        nowIso,
        id,
        organizationId
      );
      if (actor) {
        insertAuditEvent(db, {
          organizationId,
          userId: actor.id,
          action: 'MEDIA_ASSET_UPDATED',
          resourceType: 'MediaAsset',
          resourceId: id,
          details: { category: updates.category ?? existing.category },
          ipAddress: actor.ipAddress
        });
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    return await this.findAssetById(id, organizationId);
  }

  async findAssetById(id, organizationId) {
    const row = this.db.prepare('SELECT * FROM media_assets WHERE id = ? AND organizationId = ?').get(id, organizationId);
    if (!row) return null;
    const asset = mapAssetRow(row);
    const refs = await this.inspectAssetReferences(id, organizationId, asset);
    return { ...asset, references: refs, eligibleForDeletion: refs.canDelete };
  }

  async inspectAssetReferences(id, organizationId, preloadedAsset = null) {
    const db = this.db;
    const asset = preloadedAsset || mapAssetRow(
      db.prepare('SELECT * FROM media_assets WHERE id = ? AND organizationId = ?').get(id, organizationId)
    );
    if (!asset) return null;

    const reasons = [];
    if ([MEDIA_PROCESSING_STATUS.UPLOADING, MEDIA_PROCESSING_STATUS.VALIDATING, MEDIA_PROCESSING_STATUS.PROCESSING].includes(asset.processingStatus)) {
      reasons.push('ACTIVE_PROCESSING_JOB');
    }
    if (usesLocalSceneAsset(id)) {
      reasons.push('ACTIVE_BROADCAST');
    }

    const playlists = db.prepare('SELECT id, name, items FROM media_playlists WHERE organizationId = ?').all(organizationId);
    const referencedPlaylists = playlists
      .filter(p => parseJsonArray(p.items).some(item => item.assetId === id || item === id))
      .map(p => ({ id: p.id, name: p.name }));
    if (referencedPlaylists.length) {
      reasons.push('PLAYLIST_REFERENCE');
    }

    const stations = db.prepare('SELECT id FROM stations WHERE organizationId = ?').all(organizationId).map(s => s.id);
    let scheduledCount = 0;
    let adReferenceCount = 0;
    let sceneReferenceCount = 0;
    let playoutReferenceCount = 0;

    for (const stationId of stations) {
      const pendingSchedules = db.prepare(
        "SELECT scene FROM program_schedule WHERE stationId = ? AND state IN ('pending', 'running')"
      ).all(stationId);
      for (const row of pendingSchedules) {
        try {
          const scene = JSON.parse(row.scene);
          if (scene.video === id || scene.image === id || scene.mediaAssetId === id) scheduledCount++;
        } catch { /* ignore */ }
      }

      const localScene = db.prepare('SELECT scene FROM program_local_scenes WHERE stationId = ?').get(stationId);
      if (localScene) {
        try {
          const parsed = JSON.parse(localScene.scene);
          if (parsed.video === id || parsed.image === id || parsed.mediaAssetId === id) sceneReferenceCount++;
        } catch { /* ignore */ }
      }

      const namedScenes = db.prepare('SELECT scene FROM program_named_scenes WHERE stationId = ?').all(stationId);
      for (const row of namedScenes) {
        try {
          const parsed = JSON.parse(row.scene);
          if (parsed.video === id || parsed.image === id || parsed.mediaAssetId === id) sceneReferenceCount++;
        } catch { /* ignore */ }
      }

      const adRow = db.prepare('SELECT plan FROM program_ads WHERE stationId = ?').get(stationId);
      if (adRow) {
        try {
          const plan = JSON.parse(adRow.plan);
          if (plan.placements?.some(p => p.items?.some(i => i.asset === id))) adReferenceCount++;
        } catch { /* ignore */ }
      }

      const playoutRow = db.prepare('SELECT plan, state FROM station_playout WHERE stationId = ?').get(stationId);
      if (playoutRow) {
        try {
          const plan = JSON.parse(playoutRow.plan);
          const state = JSON.parse(playoutRow.state);
          if (state.current?.assetId === id || state.cued?.assetId === id) reasons.push('ACTIVE_BROADCAST');
          if (plan.items?.some(i => i.assetId === id) || plan.filler?.some(i => i.assetId === id)) playoutReferenceCount++;
        } catch { /* ignore */ }
      }
    }

    if (scheduledCount > 0) reasons.push('SCHEDULED_PLAYBACK');
    if (sceneReferenceCount > 0) reasons.push('SCENE_CONFIGURATION');
    if (adReferenceCount > 0) reasons.push('ADVERTISEMENT_PLACEMENT');
    if (playoutReferenceCount > 0) reasons.push('PLAYOUT_PLAN_OR_FALLBACK');

    const videoSourceRef = db.prepare(
      'SELECT COUNT(*) AS count FROM video_sources WHERE organizationId = ? AND (mediaAssetId = ? OR fallbackAssetId = ?)'
    ).get(organizationId, id, id);
    const videoSourceCount = Number(videoSourceRef?.count ?? 0);
    if (videoSourceCount > 0) reasons.push('VIDEO_SOURCE_REFERENCE');

    const audioSourceRef = db.prepare(
      'SELECT COUNT(*) AS count FROM audio_sources WHERE organizationId = ? AND (mediaAssetId = ? OR fallbackAssetId = ?)'
    ).get(organizationId, id, id);
    const audioSourceCount = Number(audioSourceRef?.count ?? 0);
    if (audioSourceCount > 0) reasons.push('AUDIO_SOURCE_REFERENCE');

    const channelPlayoutRows = db.prepare(
      'SELECT channelId, runtimeState, currentMediaAssetId, movieQueue, fallbackConfig, adSchedulePolicy FROM channel_playout_configs WHERE organizationId = ?'
    ).all(organizationId);
    for (const row of channelPlayoutRows) {
      const isRunning = ['STARTING', 'RUNNING', 'DEGRADED', 'RECOVERING', 'FALLBACK_ACTIVE'].includes(row.runtimeState);
      if (row.currentMediaAssetId === id && isRunning) {
        reasons.push('ACTIVE_BROADCAST');
      }
      if (
        row.currentMediaAssetId === id ||
        String(row.movieQueue || '').includes(id) ||
        String(row.fallbackConfig || '').includes(id) ||
        String(row.adSchedulePolicy || '').includes(id)
      ) {
        reasons.push('CHANNEL_PLAYOUT_REFERENCE');
      }
    }

    const scheduleRevisions = db.prepare(`
      SELECT id, lifecycleState, gapFallbackAssetId, events FROM channel_schedule_revisions
      WHERE organizationId = ? AND lifecycleState IN ('DRAFT', 'VALIDATED', 'PUBLISHED')
    `).all(organizationId);
    for (const rev of scheduleRevisions) {
      if (rev.gapFallbackAssetId === id || String(rev.events || '').includes(id)) {
        reasons.push('SCHEDULED_PLAYBACK');
      }
    }

    const uniqueReasons = [...new Set(reasons)];
    const status = uniqueReasons.includes('ACTIVE_BROADCAST')
      ? 'BROADCASTING'
      : uniqueReasons.includes('SCHEDULED_PLAYBACK') || uniqueReasons.includes('PLAYOUT_PLAN_OR_FALLBACK')
        ? 'SCHEDULED'
        : uniqueReasons.length > 0
          ? 'REFERENCED'
          : 'AVAILABLE';

    return {
      usageState: status,
      canDelete: uniqueReasons.length === 0,
      blockingReasons: uniqueReasons,
      playlists: referencedPlaylists,
      counts: {
        scheduled: scheduledCount,
        scenes: sceneReferenceCount,
        advertisements: adReferenceCount,
        playout: playoutReferenceCount
      }
    };
  }

  async listAssets(organizationId, {
    page = 1,
    pageSize = 24,
    search = '',
    category = '',
    kind = '',
    folder = '',
    tag = '',
    channelId = '',
    processingStatus = '',
    broadcastCompatibility = '',
    sortBy = 'createdAt',
    sortOrder = 'desc'
  } = {}) {
    const clauses = ['organizationId = ?'];
    const params = [organizationId];

    if (category) {
      clauses.push('category = ?');
      params.push(category);
    }
    if (kind) {
      clauses.push('kind = ?');
      params.push(kind);
    }
    if (folder) {
      clauses.push('folder = ?');
      params.push(folder);
    }
    if (processingStatus) {
      clauses.push('processingStatus = ?');
      params.push(processingStatus);
    }
    if (broadcastCompatibility) {
      clauses.push('broadcastCompatibility = ?');
      params.push(broadcastCompatibility);
    }
    if (search) {
      const pattern = `%${search.trim().toLowerCase()}%`;
      clauses.push('(LOWER(title) LIKE ? OR LOWER(description) LIKE ? OR LOWER(originalFilename) LIKE ? OR LOWER(tags) LIKE ?)');
      params.push(pattern, pattern, pattern, pattern);
    }
    if (tag) {
      clauses.push('LOWER(tags) LIKE ?');
      params.push(`%"${tag.trim().toLowerCase()}"%`);
    }
    if (channelId) {
      clauses.push('channelIds LIKE ?');
      params.push(`%"${channelId.trim()}"%`);
    }

    const allowedSort = {
      createdAt: 'createdAt',
      updatedAt: 'updatedAt',
      title: 'title',
      sizeBytes: 'sizeBytes',
      durationSeconds: 'durationSeconds'
    };
    const column = allowedSort[sortBy] || 'createdAt';
    const direction = String(sortOrder).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    const whereSql = clauses.join(' AND ');

    const totalRow = this.db.prepare(`SELECT COUNT(*) AS total FROM media_assets WHERE ${whereSql}`).get(...params);
    const total = Number(totalRow?.total ?? 0);
    const safePageSize = Math.min(100, Math.max(1, Number(pageSize) || 24));
    const safePage = Math.max(1, Number(page) || 1);
    const offset = (safePage - 1) * safePageSize;

    const rows = this.db.prepare(
      `SELECT * FROM media_assets WHERE ${whereSql} ORDER BY ${column} ${direction}, id DESC LIMIT ? OFFSET ?`
    ).all(...params, safePageSize, offset);

    const items = [];
    for (const row of rows) {
      const mapped = mapAssetRow(row);
      const references = await this.inspectAssetReferences(mapped.id, organizationId, mapped);
      items.push({
        ...mapped,
        references,
        eligibleForDeletion: references.canDelete
      });
    }

    return {
      items,
      pagination: {
        page: safePage,
        pageSize: safePageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / safePageSize))
      }
    };
  }

  async listKnownStorageKeys(organizationId) {
    const assetRows = this.db.prepare(
      'SELECT storageKey, thumbnailKey, previewKey FROM media_assets WHERE organizationId = ?'
    ).all(organizationId);
    const sessionRows = this.db.prepare(
      "SELECT uploadKey FROM media_upload_sessions WHERE organizationId = ? AND status = 'UPLOADING'"
    ).all(organizationId);
    const keys = [];
    for (const row of assetRows) {
      if (row.storageKey) keys.push(row.storageKey);
      if (row.thumbnailKey) keys.push(row.thumbnailKey);
      if (row.previewKey) keys.push(row.previewKey);
    }
    for (const row of sessionRows) {
      if (row.uploadKey) keys.push(row.uploadKey);
    }
    return keys;
  }

  async deleteAsset(id, organizationId, actor) {
    const db = this.db;
    const existing = await this.findAssetById(id, organizationId);
    if (!existing) return null;
    const refs = await this.inspectAssetReferences(id, organizationId, existing);
    if (!refs.canDelete) {
      throw Object.assign(
        new Error(`Media asset cannot be deleted while referenced (${refs.blockingReasons.join(', ')})`),
        { statusCode: 409, details: refs }
      );
    }
    db.exec('BEGIN IMMEDIATE');
    try {
      const deleted = db.prepare('DELETE FROM media_assets WHERE id = ? AND organizationId = ?').run(id, organizationId);
      if (!deleted.changes) {
        db.exec('ROLLBACK');
        return null;
      }
      if (actor) {
        insertAuditEvent(db, {
          organizationId,
          userId: actor.id,
          action: 'MEDIA_ASSET_DELETED',
          resourceType: 'MediaAsset',
          resourceId: id,
          details: {
            title: existing.title,
            category: existing.category,
            checksumSha256: existing.checksumSha256,
            sizeBytes: existing.sizeBytes
          },
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

  async createPlaylist(playlist, actor) {
    const db = this.db;
    const id = playlist.id || randomUUID();
    const nowIso = new Date().toISOString();
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const item of playlist.items || []) {
        const asset = db.prepare('SELECT id, kind, processingStatus FROM media_assets WHERE id = ? AND organizationId = ?')
          .get(item.assetId, playlist.organizationId);
        if (!asset) {
          throw Object.assign(new Error(`Playlist references unknown media asset: ${item.assetId}`), { statusCode: 404 });
        }
        if (asset.processingStatus !== MEDIA_PROCESSING_STATUS.READY) {
          throw Object.assign(new Error('Only READY validated media assets can be added to a playlist'), { statusCode: 409 });
        }
      }
      db.prepare(`
        INSERT INTO media_playlists (
          id, organizationId, name, description, kind, channelId, items, createdByUserId, createdAt, updatedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        playlist.organizationId,
        playlist.name,
        playlist.description || '',
        playlist.kind,
        playlist.channelId || null,
        JSON.stringify(playlist.items || []),
        playlist.createdByUserId,
        nowIso,
        nowIso
      );
      if (actor) {
        insertAuditEvent(db, {
          organizationId: playlist.organizationId,
          userId: actor.id,
          action: 'MEDIA_PLAYLIST_CREATED',
          resourceType: 'MediaPlaylist',
          resourceId: id,
          details: { kind: playlist.kind, itemCount: (playlist.items || []).length },
          ipAddress: actor.ipAddress
        });
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    const row = db.prepare('SELECT * FROM media_playlists WHERE id = ? AND organizationId = ?').get(id, playlist.organizationId);
    return mapPlaylistRow(row);
  }

  async listPlaylists(organizationId, { kind = '' } = {}) {
    const rows = kind
      ? this.db.prepare('SELECT * FROM media_playlists WHERE organizationId = ? AND kind = ? ORDER BY createdAt DESC')
        .all(organizationId, kind)
      : this.db.prepare('SELECT * FROM media_playlists WHERE organizationId = ? ORDER BY createdAt DESC')
        .all(organizationId);
    return rows.map(mapPlaylistRow);
  }

  async deletePlaylist(id, organizationId, actor) {
    const db = this.db;
    db.exec('BEGIN IMMEDIATE');
    let existing;
    try {
      existing = db.prepare('SELECT * FROM media_playlists WHERE id = ? AND organizationId = ?').get(id, organizationId);
      if (!existing) {
        db.exec('ROLLBACK');
        return null;
      }
      db.prepare('DELETE FROM media_playlists WHERE id = ? AND organizationId = ?').run(id, organizationId);
      if (actor) {
        insertAuditEvent(db, {
          organizationId,
          userId: actor.id,
          action: 'MEDIA_PLAYLIST_DELETED',
          resourceType: 'MediaPlaylist',
          resourceId: id,
          details: { name: existing.name, kind: existing.kind },
          ipAddress: actor.ipAddress
        });
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    return mapPlaylistRow(existing);
  }
}
