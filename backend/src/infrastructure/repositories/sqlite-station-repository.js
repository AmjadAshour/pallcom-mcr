import { IStationRepository, Station } from '@mcr/domain';
import { getSqliteDatabase } from '../database/sqlite.js';
import crypto from 'node:crypto';

export class SqliteStationRepository extends IStationRepository {
  constructor() {
    super();
    this.db = getSqliteDatabase();
  }

  async findById(id, organizationId) {
    const stmt = this.db.prepare('SELECT * FROM stations WHERE id = ? AND organizationId = ?');
    const row = stmt.get(id, organizationId);
    return row ? new Station(row) : null;
  }

  async findByOrganizationId(organizationId, filters = {}) {
    let query = 'SELECT * FROM stations WHERE organizationId = ?';
    const params = [organizationId];

    if (filters.status) {
      query += ' AND status = ?';
      params.push(filters.status);
    }
    if (filters.streamStatus) {
      query += ' AND streamStatus = ?';
      params.push(filters.streamStatus);
    }

    query += ' ORDER BY createdAt DESC';
    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params);
    return rows.map((r) => new Station(r));
  }

  async create(data) {
    if (data.studioId != null) this.#requireOrganizationStudio(data.studioId, data.organizationId);
    const id = data.id || crypto.randomUUID();
    const now = new Date().toISOString();
    const slug = data.slug || data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

    const stmt = this.db.prepare(`
      INSERT INTO stations (
        id, organizationId, studioId, name, slug, description,
        ipAddress, obsPort, encryptedPassword, status, streamStatus,
        recordStatus, currentProgramScene, currentPreviewScene,
        fps, cpuUsage, memoryUsage, droppedFrames, lastHeartbeat,
        createdAt, updatedAt
      ) VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?
      )
    `);

    stmt.run(
      id,
      data.organizationId,
      data.studioId || null,
      data.name,
      slug,
      data.description || '',
      data.ipAddress || '127.0.0.1',
      data.obsPort || 4455,
      data.encryptedPassword || null,
      data.status || 'OFFLINE',
      data.streamStatus || 'STOPPED',
      data.recordStatus || 'STOPPED',
      data.currentProgramScene || null,
      data.currentPreviewScene || null,
      data.fps || 0.0,
      data.cpuUsage || 0.0,
      data.memoryUsage || 0.0,
      data.droppedFrames || 0,
      data.lastHeartbeat || null,
      now,
      now
    );

    return await this.findById(id, data.organizationId);
  }

  async update(id, organizationId, updateData) {
    const existing = await this.findById(id, organizationId);
    if (!existing) return null;
    if (updateData.studioId != null && updateData.studioId !== existing.studioId) {
      this.#requireOrganizationStudio(updateData.studioId, organizationId);
    }

    const now = new Date().toISOString();
    const fields = [];
    const values = [];

    const allowedFields = [
      'name', 'studioId', 'description', 'ipAddress', 'obsPort',
      'encryptedPassword', 'status', 'streamStatus', 'recordStatus',
      'currentProgramScene', 'currentPreviewScene', 'fps', 'cpuUsage',
      'memoryUsage', 'droppedFrames', 'lastHeartbeat'
    ];

    for (const field of allowedFields) {
      if (updateData[field] !== undefined) {
        fields.push(`${field} = ?`);
        values.push(updateData[field]);
      }
    }

    if (fields.length === 0) return existing;

    fields.push('updatedAt = ?');
    values.push(now);
    values.push(id);
    values.push(organizationId);

    const query = `UPDATE stations SET ${fields.join(', ')} WHERE id = ? AND organizationId = ?`;
    const stmt = this.db.prepare(query);
    stmt.run(...values);

    return await this.findById(id, organizationId);
  }

  #requireOrganizationStudio(studioId, organizationId) {
    const studio = this.db.prepare('SELECT 1 FROM studios WHERE id = ? AND organizationId = ?')
      .get(studioId, organizationId);
    if (!studio) throw Object.assign(new Error('Studio not found'), { statusCode: 404 });
  }

  async updateStatus(id, statusData) {
    const fields = [];
    const values = [];

    for (const [key, val] of Object.entries(statusData)) {
      fields.push(`${key} = ?`);
      values.push(val);
    }
    fields.push('updatedAt = ?');
    values.push(new Date().toISOString());

    values.push(id);

    const query = `UPDATE stations SET ${fields.join(', ')} WHERE id = ?`;
    const stmt = this.db.prepare(query);
    stmt.run(...values);
  }

  async delete(id, organizationId) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const { changes } = this.db.prepare('DELETE FROM stations WHERE id = ? AND organizationId = ?').run(id, organizationId);
      if (changes) {
        this.db.prepare('DELETE FROM pairing_tokens WHERE stationId = ?').run(id);
        this.db.prepare('DELETE FROM station_graphics WHERE stationId = ?').run(id);
        this.db.prepare('DELETE FROM program_watermarks WHERE stationId = ?').run(id);
        for (const table of ['ad_assets','ad_frames','program_ads']) this.db.prepare('DELETE FROM ' + table + ' WHERE stationId=?').run(id);
        this.db.prepare('DELETE FROM station_graphics_tokens WHERE stationId = ?').run(id);
        this.db.prepare('DELETE FROM station_playout WHERE stationId = ?').run(id);
        this.db.prepare('DELETE FROM playout_as_run WHERE stationId = ?').run(id);
        this.db.prepare('DELETE FROM station_automations WHERE stationId = ? AND organizationId = ?').run(id, organizationId);
      }
      this.db.exec('COMMIT');
      return changes > 0;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}
