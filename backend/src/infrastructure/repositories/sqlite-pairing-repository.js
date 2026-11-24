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
      SELECT ?, ?, ?, ?, ?, NULL, ?, ?
      WHERE NOT EXISTS (
        SELECT 1 FROM pairing_tokens WHERE pairingCode = ? AND usedAt IS NULL AND expiresAt > ?
      )
    `);

    if (!stmt.run(id, stationId, pairingCode, tokenHash, expiresAt.toISOString(), createdByUserId, now, pairingCode, now).changes) {
      return null;
    }
    return { id, stationId, pairingCode, tokenHash, expiresAt, createdByUserId, createdAt: now };
  }

  async findByCode(pairingCode) {
    const stmt = this.db.prepare(`
      SELECT * FROM pairing_tokens WHERE pairingCode = ? AND usedAt IS NULL AND expiresAt > ?
    `);
    const row = stmt.get(pairingCode, new Date().toISOString());
    return row || null;
  }

}
