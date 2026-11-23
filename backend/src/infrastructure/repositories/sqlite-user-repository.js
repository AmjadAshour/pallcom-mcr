import { IUserRepository, User } from '@mcr/domain';
import { getSqliteDatabase } from '../database/sqlite.js';
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

  async create(data) {
    const id = data.id || crypto.randomUUID();
    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO users (id, email, passwordHash, fullName, isActive, role, organizationId, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      data.email.toLowerCase().trim(),
      data.passwordHash,
      data.fullName,
      data.isActive !== undefined ? (data.isActive ? 1 : 0) : 1,
      data.role || 'OPERATOR',
      data.organizationId || null,
      now,
      now
    );

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
