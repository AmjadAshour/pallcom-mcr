import { getSqliteDatabase } from '../database/sqlite.js';
import { insertAuditEvent } from '../repositories/sqlite-audit-repository.js';

export function currentAgentGeneration(stationId, organizationId) {
  return getSqliteDatabase().prepare(`
    SELECT COALESCE(c.generation, 0) AS generation
    FROM stations AS s LEFT JOIN station_agent_credentials AS c ON c.stationId = s.id
    WHERE s.id = ? AND s.organizationId = ?
  `).get(stationId, organizationId)?.generation ?? null;
}

export function rotateAgentCredential(stationId, organizationId, { pairingId = null, actorId, ipAddress }) {
  const db = getSqliteDatabase();
  db.exec('BEGIN IMMEDIATE');
  try {
    const generation = currentAgentGeneration(stationId, organizationId);
    const now = new Date().toISOString();
    const claimable = pairingId === null || db.prepare(`
      SELECT 1 FROM pairing_tokens WHERE id = ? AND stationId = ? AND usedAt IS NULL AND expiresAt > ?
    `).get(pairingId, stationId, now);
    if (generation === null || !claimable) {
      db.exec('ROLLBACK');
      return null;
    }
    const next = generation + 1;
    db.prepare(`
      INSERT INTO station_agent_credentials (stationId, generation) VALUES (?, ?)
      ON CONFLICT(stationId) DO UPDATE SET generation = excluded.generation
    `).run(stationId, next);
    db.prepare('UPDATE pairing_tokens SET usedAt = ? WHERE stationId = ? AND usedAt IS NULL').run(now, stationId);
    insertAuditEvent(db, {
      organizationId, userId: actorId, resourceType: 'StationAgent', resourceId: stationId, ipAddress,
      action: pairingId === null ? 'AGENT_CREDENTIAL_REVOKED' : 'AGENT_PAIRED_SUCCESS',
      details: { generation: next }
    });
    db.exec('COMMIT');
    return next;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
