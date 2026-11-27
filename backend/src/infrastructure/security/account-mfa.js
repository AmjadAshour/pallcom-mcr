import { randomBytes } from 'node:crypto';
import { getSqliteDatabase } from '../database/sqlite.js';
import { insertAuditEvent } from '../repositories/sqlite-audit-repository.js';
import { accountError, editAccount } from './account-management.js';
import { CryptoService } from './crypto-service.js';
import { createSession } from './session-service.js';
import { base32, matchingTotpStep } from './totp.js';

function getFactor(db, userId) {
  return db.prepare('SELECT encryptedSecret, enabled, pendingUntil, lastStep FROM auth_mfa WHERE userId = ?').get(userId);
}

function invalidateSessions(db, userId) {
  const sessions = db.prepare('SELECT id FROM auth_sessions WHERE userId = ?').all(userId);
  db.prepare('DELETE FROM auth_sessions WHERE userId = ?').run(userId);
  return sessions;
}

function matchingStep(factor, code) {
  const secret = Buffer.from(CryptoService.decryptSecret(factor.encryptedSecret), 'hex');
  return matchingTotpStep(secret, code, factor.lastStep);
}

function consumeFactor(db, userId, factor, code) {
  if (/^[A-Za-z0-9_-]{16}$/.test(code ?? '')) {
    return Boolean(db.prepare('DELETE FROM auth_mfa_recovery_codes WHERE userId = ? AND codeHash = ?')
      .run(userId, CryptoService.hashToken(code)).changes);
  }
  const step = matchingStep(factor, code);
  if (step === null) return false;
  db.prepare('UPDATE auth_mfa SET lastStep = ? WHERE userId = ?').run(step, userId);
  return true;
}

export function mfaEnabled(userId) {
  return Boolean(getFactor(getSqliteDatabase(), userId)?.enabled);
}

export function startMfa(actor, ipAddress, passwordHash) {
  return editAccount(actor, ipAddress, passwordHash, db => {
    if (getFactor(db, actor.id)?.enabled) throw accountError(409, 'Two-factor authentication is already enabled.');
    const secret = randomBytes(20);
    db.prepare(`
      INSERT INTO auth_mfa (userId, encryptedSecret, enabled, pendingUntil)
      VALUES (?, ?, 0, ?)
      ON CONFLICT(userId) DO UPDATE SET encryptedSecret = excluded.encryptedSecret, pendingUntil = excluded.pendingUntil
    `).run(actor.id, CryptoService.encryptSecret(secret.toString('hex')), Date.now() + 10 * 60000);
    return { action: 'MFA_ENROLLMENT_STARTED', value: base32(secret) };
  });
}

export function confirmMfa(actor, ipAddress, passwordHash, code) {
  return editAccount(actor, ipAddress, passwordHash, db => {
    const factor = getFactor(db, actor.id);
    if (!factor || factor.enabled || factor.pendingUntil <= Date.now()) throw accountError(409, 'Start a new enrollment.');
    const step = matchingStep(factor, code);
    if (step === null) throw accountError(403, 'Invalid verification code.');
    const codes = Array.from({ length: 8 }, () => randomBytes(12).toString('base64url'));
    const insert = db.prepare('INSERT INTO auth_mfa_recovery_codes (userId, codeHash) VALUES (?, ?)');
    for (const recoveryCode of codes) insert.run(actor.id, CryptoService.hashToken(recoveryCode));
    db.prepare('UPDATE auth_mfa SET enabled = 1, pendingUntil = 0, lastStep = ? WHERE userId = ?').run(step, actor.id);
    return { action: 'MFA_ENABLED', revokedIds: invalidateSessions(db, actor.id), value: codes };
  });
}

export function disableMfa(actor, ipAddress, passwordHash, code) {
  editAccount(actor, ipAddress, passwordHash, db => {
    const factor = getFactor(db, actor.id);
    if (!factor?.enabled || !consumeFactor(db, actor.id, factor, code)) throw accountError(403, 'Invalid verification code.');
    db.prepare('DELETE FROM auth_mfa_recovery_codes WHERE userId = ?').run(actor.id);
    db.prepare('DELETE FROM auth_mfa WHERE userId = ?').run(actor.id);
    return { action: 'MFA_DISABLED', revokedIds: invalidateSessions(db, actor.id) };
  });
}

export function startVerifiedLogin(user, ipAddress, code) {
  const db = getSqliteDatabase();
  db.exec('BEGIN IMMEDIATE');
  try {
    const current = db.prepare(`
      SELECT id, email, fullName, role, COALESCE(organizationId, 'default-org') AS organizationId
      FROM users WHERE id = ? AND isActive = 1 AND passwordHash = ?
    `).get(user.id, user.passwordHash);
    if (!current) {
      db.exec('ROLLBACK');
      return {};
    }
    const factor = getFactor(db, user.id);
    if (factor?.enabled && !consumeFactor(db, user.id, factor, code)) {
      if (code) insertAuditEvent(db, {
        organizationId: current.organizationId, userId: user.id, action: 'LOGIN_FAILED',
        resourceType: 'User', resourceId: user.id, ipAddress, details: { reason: 'Invalid second factor' }
      });
      db.exec('COMMIT');
      return { secondFactorRequired: true };
    }
    const session = createSession(user.id);
    insertAuditEvent(db, {
      organizationId: current.organizationId, userId: user.id, action: 'LOGIN_SUCCESS',
      resourceType: 'User', resourceId: user.id, ipAddress
    });
    db.exec('COMMIT');
    return { current, session };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
