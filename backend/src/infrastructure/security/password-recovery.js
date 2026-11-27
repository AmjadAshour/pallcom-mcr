import { randomBytes } from 'node:crypto';
import { env } from '../../config/env.js';
import { getSqliteDatabase } from '../database/sqlite.js';
import { insertAuditEvent } from '../repositories/sqlite-audit-repository.js';
import { accountError } from './account-management.js';
import { CryptoService } from './crypto-service.js';
import { sessionEvents } from './session-service.js';

const delivering = new Set();
const lifetime = 15 * 60 * 1000;
export const recoveryEnabled = Boolean(env.PASSWORD_RESET_DELIVERY_URL);

export function requestPasswordReset(email, ipAddress) {
  const identity = email.trim().toLowerCase();
  if (!recoveryEnabled || delivering.has(identity) || delivering.size >= 16) return;
  delivering.add(identity);
  setImmediate(() => {
    void deliverReset(identity, ipAddress).catch(() => {
      // The public response and logs do not include account or grant details.
      console.warn('Password recovery delivery failed.');
    }).finally(() => delivering.delete(identity));
  });
}

async function deliverReset(email, ipAddress) {
  const db = getSqliteDatabase();
  const user = db.prepare(`
    SELECT id, COALESCE(organizationId, 'default-org') AS organizationId
    FROM users WHERE email = ? AND isActive = 1
  `).get(email);
  if (!user) return;
  const token = randomBytes(32).toString('base64url');
  const hash = CryptoService.hashToken(token);
  const now = Date.now();
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('DELETE FROM password_reset_grants WHERE expiresAt <= ?').run(now);
    const inserted = db.prepare(`
      INSERT INTO password_reset_grants (userId, tokenHash, expiresAt)
      SELECT id, ?, ? FROM users WHERE id = ? AND isActive = 1
      ON CONFLICT(userId) DO UPDATE SET tokenHash = excluded.tokenHash, expiresAt = excluded.expiresAt
    `).run(hash, now + lifetime, user.id);
    if (inserted.changes) insertAuditEvent(db, {
      organizationId: user.organizationId, userId: user.id, action: 'PASSWORD_RESET_REQUESTED',
      resourceType: 'User', resourceId: user.id, ipAddress
    });
    db.exec('COMMIT');
    if (!inserted.changes) return;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  try {
    const response = await fetch(env.PASSWORD_RESET_DELIVERY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + env.PASSWORD_RESET_DELIVERY_KEY },
      body: JSON.stringify({ email, resetUrl: env.CORS_ORIGIN + '/#reset=' + token }),
      redirect: 'error',
      signal: AbortSignal.timeout(4000)
    });
    await response.body?.cancel();
    if (!response.ok) throw new Error('Delivery failed.');
  } catch (error) {
    db.prepare('DELETE FROM password_reset_grants WHERE tokenHash = ?').run(hash);
    throw error;
  }
}

export function findResetGrant(hash) {
  return getSqliteDatabase().prepare(`
    SELECT u.id, COALESCE(u.organizationId, 'default-org') AS organizationId
    FROM password_reset_grants AS g JOIN users AS u ON u.id = g.userId
    WHERE g.tokenHash = ? AND g.expiresAt > ? AND u.isActive = 1
  `).get(hash, Date.now());
}

export function finishPasswordReset(hash, newHash, ipAddress) {
  const db = getSqliteDatabase();
  let sessions;
  db.exec('BEGIN IMMEDIATE');
  try {
    const user = findResetGrant(hash);
    if (!user) throw accountError(400, 'Invalid or expired password reset link.');
    sessions = db.prepare('SELECT id FROM auth_sessions WHERE userId = ?').all(user.id);
    db.prepare('UPDATE users SET passwordHash = ?, updatedAt = ? WHERE id = ?')
      .run(newHash, new Date().toISOString(), user.id);
    insertAuditEvent(db, {
      organizationId: user.organizationId, userId: user.id, action: 'PASSWORD_RESET',
      resourceType: 'User', resourceId: user.id, ipAddress
    });
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  for (const { id } of sessions) sessionEvents.emit('revoked', id);
}
