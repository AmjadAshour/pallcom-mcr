import { getSqliteDatabase } from '../database/sqlite.js';
import crypto from 'node:crypto';

export class SqlitePairingRepository {
  constructor() {
    this.db = getSqliteDatabase();
  }

  async createToken({ stationId, pairingCode, tokenHash, expiresAt, createdByUserId }) {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO pairing_tokens (id, stationId, pairingCode, tokenHash, expiresAt, usedAt, createdByUserId, createdAt)
      VALUES (?, ?, ?, ?, ?, NULL, ?, ?)
    `);

    stmt.run(id, stationId, pairingCode, tokenHash, expiresAt.toISOString(), createdByUserId, now);
    return { id, stationId, pairingCode, tokenHash, expiresAt, createdByUserId, createdAt: now };
  }

  async findByCode(pairingCode) {
    const stmt = this.db.prepare(`
      SELECT * FROM pairing_tokens WHERE pairingCode = ? AND usedAt IS NULL
    `);
    const row = stmt.get(pairingCode);
    return row || null;
  }

  async markUsed(id) {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      UPDATE pairing_tokens SET usedAt = ? WHERE id = ? AND usedAt IS NULL AND expiresAt > ?
    `);
    return stmt.run(now, id, now).changes === 1;
  }
}
