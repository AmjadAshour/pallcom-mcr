import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { getSqliteDatabase } from '../database/sqlite.js';
import { CryptoService } from './crypto-service.js';

export const sessionEvents = new EventEmitter();

function issue(id, userId) {
  const refresh = CryptoService.signRefreshToken({ sub: userId, sid: id, jti: randomUUID() });
  const expiresAt = CryptoService.verifyRefreshToken(refresh).exp * 1000;
  return { refresh, expiresAt, hash: CryptoService.hashToken(refresh) };
}

export function createSession(userId) {
  const id = randomUUID();
  const tokens = issue(id, userId);
  const db = getSqliteDatabase();
  db.prepare('DELETE FROM auth_sessions WHERE expiresAt <= ?').run(Date.now());
  db.prepare('INSERT INTO auth_sessions VALUES (?, ?, ?, ?)').run(id, userId, tokens.hash, tokens.expiresAt);
  return { id, ...tokens };
}

export function revokeSession(id, userId) {
  const result = getSqliteDatabase().prepare('DELETE FROM auth_sessions WHERE id = ? AND userId = ?').run(id, userId);
  if (result.changes) sessionEvents.emit('revoked', id);
}

export function rotateSession(claims, refresh) {
  if (!claims.sid || !claims.jti) return null;
  const { sid, sub } = claims;
  const tokens = issue(sid, sub);
  const result = getSqliteDatabase().prepare(
    'UPDATE auth_sessions SET refreshHash = ?, expiresAt = ? WHERE id = ? AND userId = ? AND refreshHash = ? AND expiresAt > ?'
  ).run(tokens.hash, tokens.expiresAt, sid, sub, CryptoService.hashToken(refresh), Date.now());
  if (result.changes) return tokens;
  revokeSession(sid, sub);
  return null;
}

export function sessionUser(claims) {
  if (!claims.sid || !claims.sub || claims.exp * 1000 <= Date.now()) return null;
  return getSqliteDatabase().prepare(`
    SELECT u.id, u.email, u.role, COALESCE(u.organizationId, 'default-org') AS organizationId
    FROM auth_sessions AS s JOIN users AS u ON u.id = s.userId
    WHERE s.id = ? AND s.userId = ? AND s.expiresAt > ? AND u.isActive = 1
  `).get(claims.sid, claims.sub, Date.now()) ?? null;
}
