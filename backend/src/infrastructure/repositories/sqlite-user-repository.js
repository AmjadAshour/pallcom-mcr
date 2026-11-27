import { IUserRepository, User } from '@mcr/domain';
import { getSqliteDatabase } from '../database/sqlite.js';
import { insertAuditEvent } from './sqlite-audit-repository.js';
import { managedAccountRoles } from '../security/account-management.js';
import { activeSessionUser } from '../security/session-service.js';
import { hasPermission } from '../../presentation/middlewares/rbac.middleware.js';
import crypto from 'node:crypto';

export class SqliteUserRepository extends IUserRepository {
  constructor() {
    super();
    this.db = getSqliteDatabase();
  }

  async findById(id) {
    const stmt = this.db.prepare('SELECT * FROM users WHERE id = ?');
    const row = stmt.get(id);
    return row ? new User(row) : null;
  }

  async findByEmail(email) {
    const stmt = this.db.prepare('SELECT * FROM users WHERE email = ?');
    const row = stmt.get(email.toLowerCase().trim());
    return row ? { ...row, isActive: Boolean(row.isActive) } : null;
  }

  async listByOrganization(organizationId) {
    return this.db.prepare("SELECT id, email, fullName, role, isActive FROM users WHERE COALESCE(organizationId, 'default-org') = ? ORDER BY fullName")
      .all(organizationId);
  }

  async create(data, { actor } = {}) {
    const id = data.id || crypto.randomUUID();
    const now = new Date().toISOString();
    const role = data.role || 'OPERATOR';
    const email = data.email.toLowerCase().trim();

    const stmt = this.db.prepare(`
      INSERT INTO users (id, email, passwordHash, fullName, isActive, role, organizationId, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const values = [
      id,
      email,
      data.passwordHash,
      data.fullName,
      data.isActive !== undefined ? (data.isActive ? 1 : 0) : 1,
      role,
      data.organizationId || null,
      now,
      now
    ];

    if (actor) {
      this.db.exec('BEGIN IMMEDIATE');
      try {
        const current = activeSessionUser(actor.sessionId, actor.id);
        if (!current || current.organizationId !== data.organizationId || !hasPermission(current.role, 'user:manage')) {
          throw Object.assign(new Error('Access denied.'), { status: 403 });
        }
        if (!managedAccountRoles.includes(role)) {
          throw Object.assign(new Error('Role is not assignable.'), { status: 403 });
        }
        if (this.db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
          throw Object.assign(new Error('Email is already registered'), { status: 409 });
        }
        stmt.run(...values);
        insertAuditEvent(this.db, {
          organizationId: data.organizationId,
          userId: actor.id,
          action: 'USER_CREATED',
          resourceType: 'User',
          resourceId: id,
          details: { role },
          ipAddress: actor.ipAddress
        });
        this.db.exec('COMMIT');
      } catch (error) {
        this.db.exec('ROLLBACK');
        throw error;
      }
    } else {
      stmt.run(...values);
    }

    return await this.findById(id);
  }

  async update(id, updateData) {
    const now = new Date().toISOString();
    const fields = [];
    const values = [];

    for (const [key, val] of Object.entries(updateData)) {
      fields.push(`${key} = ?`);
      values.push(key === 'isActive' ? (val ? 1 : 0) : val);
    }

    if (fields.length === 0) return await this.findById(id);

    fields.push('updatedAt = ?');
    values.push(now);
    values.push(id);

    const query = `UPDATE users SET ${fields.join(', ')} WHERE id = ?`;
    const stmt = this.db.prepare(query);
    stmt.run(...values);

    return await this.findById(id);
  }
}
