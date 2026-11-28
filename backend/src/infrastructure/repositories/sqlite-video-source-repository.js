import { randomUUID } from 'node:crypto';
import { IVideoSourceRepository } from '@mcr/domain';
import { VIDEO_SOURCE_AVAILABILITY, VIDEO_SOURCE_CONNECTION_STATUS } from '@mcr/shared';
import { getSqliteDatabase } from '../database/sqlite.js';
import { insertAuditEvent } from './sqlite-audit-repository.js';

function mapVideoSourceRow(row, { includeEncryptedSecret = false } = {}) {
  if (!row) return null;
  const mapped = {
    id: row.id,
    organizationId: row.organizationId,
    stationId: row.stationId || null,
    name: row.name,
    description: row.description || '',
    sourceType: row.sourceType,
    mediaAssetId: row.mediaAssetId || null,
    playlistId: row.playlistId || null,
    streamUrl: row.streamUrl || null,
    hasSecret: Boolean(row.encryptedSecret),
    serverFilePath: row.serverFilePath || null,
    connectionStatus: row.connectionStatus,
    availabilityStatus: row.availabilityStatus,
    width: row.width ?? null,
    height: row.height ?? null,
    frameRate: row.frameRate ?? null,
    videoCodec: row.videoCodec || null,
    audioCodec: row.audioCodec || null,
    hasAudio: Boolean(row.hasAudio),
    previewThumbnailKey: row.previewThumbnailKey || null,
    lastConnectedAt: row.lastConnectedAt || null,
    lastProbedAt: row.lastProbedAt || null,
    lastError: row.lastError || null,
    reconnectEnabled: Boolean(row.reconnectEnabled),
    maxRetries: Number(row.maxRetries ?? 5),
    retryCount: Number(row.retryCount ?? 0),
    backoffBaseMs: Number(row.backoffBaseMs ?? 2000),
    backoffMaxMs: Number(row.backoffMaxMs ?? 30000),
    fallbackSourceId: row.fallbackSourceId || null,
    fallbackAssetId: row.fallbackAssetId || null,
    fallbackMode: row.fallbackMode || 'SLATE',
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
  if (includeEncryptedSecret) mapped.encryptedSecret = row.encryptedSecret || null;
  return mapped;
}

export class SqliteVideoSourceRepository extends IVideoSourceRepository {
  get db() {
    return getSqliteDatabase();
  }

  async createSource(source, actor) {
    const db = this.db;
    const id = source.id || randomUUID();
    const nowIso = new Date().toISOString();
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(`
        INSERT INTO video_sources (
          id, organizationId, stationId, name, description, sourceType,
          mediaAssetId, playlistId, streamUrl, encryptedSecret, serverFilePath,
          connectionStatus, availabilityStatus, width, height, frameRate,
          videoCodec, audioCodec, hasAudio, previewThumbnailKey,
          lastConnectedAt, lastProbedAt, lastError,
          reconnectEnabled, maxRetries, retryCount, backoffBaseMs, backoffMaxMs,
          fallbackSourceId, fallbackAssetId, fallbackMode,
          createdByUserId, createdAt, updatedAt
        ) VALUES (
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?,
          ?, ?, 0, ?, ?,
          ?, ?, ?,
          ?, ?, ?
        )
      `).run(
        id,
        source.organizationId,
        source.stationId || null,
        source.name,
        source.description || '',
        source.sourceType,
        source.mediaAssetId || null,
        source.playlistId || null,
        source.streamUrl || null,
        source.encryptedSecret || null,
        source.serverFilePath || null,
        source.connectionStatus || VIDEO_SOURCE_CONNECTION_STATUS.OFFLINE,
        source.availabilityStatus || VIDEO_SOURCE_AVAILABILITY.UNAVAILABLE,
        source.width ?? null,
        source.height ?? null,
        source.frameRate ?? null,
        source.videoCodec || null,
        source.audioCodec || null,
        source.hasAudio ? 1 : 0,
        source.previewThumbnailKey || null,
        source.lastConnectedAt || null,
        source.lastProbedAt || null,
        source.lastError || null,
        source.reconnectEnabled !== undefined ? (source.reconnectEnabled ? 1 : 0) : 1,
        source.maxRetries ?? 5,
        source.backoffBaseMs ?? 2000,
        source.backoffMaxMs ?? 30000,
        source.fallbackSourceId || null,
        source.fallbackAssetId || null,
        source.fallbackMode || 'SLATE',
        source.createdByUserId,
        nowIso,
        nowIso
      );
      if (actor) {
        insertAuditEvent(db, {
          organizationId: source.organizationId,
          userId: actor.id,
          action: 'VIDEO_SOURCE_CREATED',
          resourceType: 'VideoSource',
          resourceId: id,
          details: { sourceType: source.sourceType, name: source.name },
          ipAddress: actor.ipAddress
        });
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    return await this.findSourceById(id, source.organizationId);
  }

  async updateSource(id, organizationId, updates, actor) {
    const db = this.db;
    const existing = db.prepare('SELECT * FROM video_sources WHERE id = ? AND organizationId = ?').get(id, organizationId);
    if (!existing) return null;
    const nowIso = new Date().toISOString();
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(`
        UPDATE video_sources SET
          name = ?, description = ?, stationId = ?, streamUrl = ?, encryptedSecret = ?,
          mediaAssetId = ?, playlistId = ?, reconnectEnabled = ?, maxRetries = ?,
          backoffBaseMs = ?, backoffMaxMs = ?, fallbackSourceId = ?, fallbackAssetId = ?,
          fallbackMode = ?, updatedAt = ?
        WHERE id = ? AND organizationId = ?
      `).run(
        updates.name ?? existing.name,
        updates.description ?? existing.description,
        updates.stationId !== undefined ? updates.stationId : existing.stationId,
        updates.streamUrl !== undefined ? updates.streamUrl : existing.streamUrl,
        updates.encryptedSecret !== undefined ? updates.encryptedSecret : existing.encryptedSecret,
        updates.mediaAssetId !== undefined ? updates.mediaAssetId : existing.mediaAssetId,
        updates.playlistId !== undefined ? updates.playlistId : existing.playlistId,
        updates.reconnectEnabled !== undefined ? (updates.reconnectEnabled ? 1 : 0) : existing.reconnectEnabled,
        updates.maxRetries ?? existing.maxRetries,
        updates.backoffBaseMs ?? existing.backoffBaseMs,
        updates.backoffMaxMs ?? existing.backoffMaxMs,
        updates.fallbackSourceId !== undefined ? updates.fallbackSourceId : existing.fallbackSourceId,
        updates.fallbackAssetId !== undefined ? updates.fallbackAssetId : existing.fallbackAssetId,
        updates.fallbackMode ?? existing.fallbackMode,
        nowIso,
        id,
        organizationId
      );
      if (actor) {
        insertAuditEvent(db, {
          organizationId,
          userId: actor.id,
          action: 'VIDEO_SOURCE_UPDATED',
          resourceType: 'VideoSource',
          resourceId: id,
          details: { name: updates.name ?? existing.name },
          ipAddress: actor.ipAddress
        });
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    return await this.findSourceById(id, organizationId);
  }

  async updateSourceProbeState(id, organizationId, probe) {
    const db = this.db;
    const existing = db.prepare('SELECT * FROM video_sources WHERE id = ? AND organizationId = ?').get(id, organizationId);
    if (!existing) return null;
    const nowIso = new Date().toISOString();
    db.prepare(`
      UPDATE video_sources SET
        connectionStatus = ?, availabilityStatus = ?, width = ?, height = ?, frameRate = ?,
        videoCodec = ?, audioCodec = ?, hasAudio = ?, previewThumbnailKey = ?,
        lastConnectedAt = ?, lastProbedAt = ?, lastError = ?, retryCount = ?, updatedAt = ?
      WHERE id = ? AND organizationId = ?
    `).run(
      probe.connectionStatus ?? existing.connectionStatus,
      probe.availabilityStatus ?? existing.availabilityStatus,
      probe.width !== undefined ? probe.width : existing.width,
      probe.height !== undefined ? probe.height : existing.height,
      probe.frameRate !== undefined ? probe.frameRate : existing.frameRate,
      probe.videoCodec !== undefined ? probe.videoCodec : existing.videoCodec,
      probe.audioCodec !== undefined ? probe.audioCodec : existing.audioCodec,
      (probe.hasAudio !== undefined ? probe.hasAudio : Boolean(existing.hasAudio)) ? 1 : 0,
      probe.previewThumbnailKey !== undefined ? probe.previewThumbnailKey : existing.previewThumbnailKey,
      probe.lastConnectedAt !== undefined ? probe.lastConnectedAt : existing.lastConnectedAt,
      nowIso,
      probe.lastError !== undefined ? probe.lastError : existing.lastError,
      probe.retryCount !== undefined ? probe.retryCount : existing.retryCount,
      nowIso,
      id,
      organizationId
    );
    return await this.findSourceById(id, organizationId);
  }

  async findSourceById(id, organizationId, options = {}) {
    const row = this.db.prepare('SELECT * FROM video_sources WHERE id = ? AND organizationId = ?').get(id, organizationId);
    return mapVideoSourceRow(row, options);
  }

  async listSources(organizationId, { sourceType = '', stationId = '', availabilityStatus = '', search = '' } = {}) {
    const clauses = ['organizationId = ?'];
    const params = [organizationId];
    if (sourceType) {
      clauses.push('sourceType = ?');
      params.push(sourceType);
    }
    if (stationId) {
      clauses.push('stationId = ?');
      params.push(stationId);
    }
    if (availabilityStatus) {
      clauses.push('availabilityStatus = ?');
      params.push(availabilityStatus);
    }
    if (search) {
      clauses.push('(LOWER(name) LIKE ? OR LOWER(description) LIKE ?)');
      const pat = `%${search.trim().toLowerCase()}%`;
      params.push(pat, pat);
    }
    const rows = this.db.prepare(
      `SELECT * FROM video_sources WHERE ${clauses.join(' AND ')} ORDER BY createdAt DESC`
    ).all(...params);
    return rows.map(r => mapVideoSourceRow(r));
  }

  async deleteSource(id, organizationId, actor) {
    const db = this.db;
    const existing = await this.findSourceById(id, organizationId);
    if (!existing) return null;
    const fallbackUsers = db.prepare(
      'SELECT COUNT(*) AS count FROM video_sources WHERE organizationId = ? AND fallbackSourceId = ?'
    ).get(organizationId, id);
    if (Number(fallbackUsers?.count ?? 0) > 0) {
      throw Object.assign(
        new Error('Cannot delete a video source while it is configured as a fallback for another source'),
        { statusCode: 409 }
      );
    }
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('DELETE FROM video_sources WHERE id = ? AND organizationId = ?').run(id, organizationId);
      if (actor) {
        insertAuditEvent(db, {
          organizationId,
          userId: actor.id,
          action: 'VIDEO_SOURCE_DELETED',
          resourceType: 'VideoSource',
          resourceId: id,
          details: { name: existing.name, sourceType: existing.sourceType },
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
}
