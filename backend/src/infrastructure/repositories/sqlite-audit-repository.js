import { IAuditLogRepository } from '@mcr/domain';
import { getSqliteDatabase } from '../database/sqlite.js';
import crypto from 'node:crypto';

export function insertAuditEvent(db, { organizationId, userId = null, action, resourceType, resourceId = null, details = {}, ipAddress = null }) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const detailsJson = typeof details === 'string' ? details : JSON.stringify(details);

  const stmt = db.prepare(`
    INSERT INTO audit_logs (id, organizationId, userId, action, resourceType, resourceId, details, ipAddress, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(id, organizationId, userId, action, resourceType, resourceId, detailsJson, ipAddress, now);
  return { id, organizationId, userId, action, resourceType, resourceId, details, ipAddress, createdAt: now };
}

export class SqliteAuditRepository extends IAuditLogRepository {
  constructor() {
    super();
    this.db = getSqliteDatabase();
  }

  async create(event) {
    return insertAuditEvent(this.db, event);
  }

  async findByOrganizationId(organizationId, options = {}) {
    const limit = options.limit || 50;
    const stmt = this.db.prepare(`
      SELECT * FROM audit_logs WHERE organizationId = ? ORDER BY createdAt DESC LIMIT ?
    `);
    const rows = stmt.all(organizationId, limit);
    return rows.map((r) => ({
      ...r,
      details: r.details ? JSON.parse(r.details) : null
    }));
  }
}
