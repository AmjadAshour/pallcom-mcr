import { getSqliteDatabase } from '../database/sqlite.js';
import { insertAuditEvent } from '../repositories/sqlite-audit-repository.js';
import { hasPermission } from '../../presentation/middlewares/rbac.middleware.js';
import { activeSessionUser, sessionEvents } from './session-service.js';

export const managedAccountRoles = ['STUDIO_MANAGER', 'OPERATOR', 'VIEWER'];

export function accountError(status, message) {
  return Object.assign(new Error(message), { status });
}

export function editAccount(actor, ipAddress, passwordHash, edit) {
  const db = getSqliteDatabase();
  db.exec('BEGIN IMMEDIATE');
  let revoked = [];
  let result;
  try {
    const current = activeSessionUser(actor.sessionId, actor.id);
    if (!current || current.organizationId !== actor.organizationId) {
      throw accountError(401, 'Invalid session or inactive user.');
    }
    if (passwordHash && db.prepare('SELECT passwordHash FROM users WHERE id = ?').get(actor.id).passwordHash !== passwordHash) {
      throw accountError(403, 'Current password is incorrect.');
    }
    const { action, target = actor.id, details, revokedIds, value } = edit(db, current);
    revoked = revokedIds ?? [];
    result = value;
    insertAuditEvent(db, {
      organizationId: current.organizationId, userId: actor.id, action, resourceType: 'User',
      resourceId: target, ipAddress, details
    });
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  for (const { id } of revoked) sessionEvents.emit('revoked', id);
  return result;
}

function sessionsOf(db, id) {
  return db.prepare('SELECT id FROM auth_sessions WHERE userId = ?').all(id);
}

export function updateProfile(actor, ipAddress, fullName) {
  editAccount(actor, ipAddress, null, db => {
    db.prepare('UPDATE users SET fullName = ?, updatedAt = ? WHERE id = ?')
      .run(fullName, new Date().toISOString(), actor.id);
    return { action: 'PROFILE_UPDATED' };
  });
}

export function changeAccountPassword(actor, ipAddress, currentHash, newHash) {
  editAccount(actor, ipAddress, currentHash, db => {
    const revokedIds = sessionsOf(db, actor.id);
    db.prepare('UPDATE users SET passwordHash = ?, updatedAt = ? WHERE id = ?')
      .run(newHash, new Date().toISOString(), actor.id);
    return { action: 'PASSWORD_CHANGED', revokedIds };
  });
}

function managedAccount(db, current, targetId) {
  if (!hasPermission(current.role, 'user:manage')) throw accountError(403, 'Access denied.');
  const target = db.prepare(
    "SELECT role, isActive FROM users WHERE id = ? AND COALESCE(organizationId, 'default-org') = ?"
  ).get(targetId, current.organizationId);
  if (!target || !managedAccountRoles.includes(target.role) || targetId === current.id) {
    throw accountError(404, 'User not found.');
  }
  return target;
}

export function changeAccountStatus(actor, ipAddress, currentHash, targetId, active) {
  editAccount(actor, ipAddress, currentHash, (db, current) => {
    const target = managedAccount(db, current, targetId);
    if (Boolean(target.isActive) === active) throw accountError(409, 'Account already has this status.');
    const revokedIds = active ? [] : sessionsOf(db, targetId);
    db.prepare('UPDATE users SET isActive = ?, updatedAt = ? WHERE id = ?')
      .run(Number(active), new Date().toISOString(), targetId);
    return { action: active ? 'ACCOUNT_ACTIVATED' : 'ACCOUNT_DEACTIVATED', target: targetId, revokedIds };
  });
}

export function changeAccountRole(actor, ipAddress, currentHash, targetId, role) {
  editAccount(actor, ipAddress, currentHash, (db, current) => {
    const target = managedAccount(db, current, targetId);
    if (!managedAccountRoles.includes(role)) throw accountError(403, 'Role is not assignable.');
    if (target.role === role) throw accountError(409, 'Account already has this role.');
    const revokedIds = sessionsOf(db, targetId);
    db.prepare('UPDATE users SET role = ?, updatedAt = ? WHERE id = ?')
      .run(role, new Date().toISOString(), targetId);
    db.prepare('DELETE FROM auth_sessions WHERE userId = ?').run(targetId);
    return { action: 'ACCOUNT_ROLE_CHANGED', target: targetId, details: { previousRole: target.role, role }, revokedIds };
  });
}

export function listOwnSessions(actor) {
  return getSqliteDatabase().prepare(
    'SELECT id, expiresAt FROM auth_sessions WHERE userId = ? AND expiresAt > ? ORDER BY expiresAt DESC, id'
  ).all(actor.id, Date.now()).map(session => ({ ...session, current: session.id === actor.sessionId }));
}

export function revokeOwnSession(actor, ipAddress, id) {
  editAccount(actor, ipAddress, null, db => {
    const result = db.prepare('DELETE FROM auth_sessions WHERE id = ? AND userId = ? AND expiresAt > ?')
      .run(id, actor.id, Date.now());
    if (!result.changes) throw accountError(404, 'Session not found.');
    return { action: 'SESSION_REVOKED', revokedIds: [{ id }] };
  });
}
