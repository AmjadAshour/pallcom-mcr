import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { io } from 'socket.io-client';

test('account changes preserve scope, audit integrity and session revocation', { timeout: 20000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'mcr-accounts-'));
  const secret = () => randomBytes(32).toString('hex');
  Object.assign(process.env, {
    NODE_ENV: 'test', STORAGE_MODE: 'sqlite', SQLITE_DB_PATH: join(directory, 'fixture.sqlite'),
    JWT_SECRET: secret(), REFRESH_TOKEN_SECRET: secret(), ENCRYPTION_MASTER_KEY: secret()
  });
  const { server } = await import('../src/index.js');
  const { getSqliteDatabase } = await import('../src/infrastructure/database/sqlite.js');
  const { SqliteUserRepository } = await import('../src/infrastructure/repositories/sqlite-user-repository.js');
  const { CryptoService } = await import('../src/infrastructure/security/crypto-service.js');
  const db = getSqliteDatabase();
  const users = new SqliteUserRepository();
  const password = secret();
  const newPassword = secret();
  const passwordHash = await CryptoService.hashPassword(password);
  const add = (id, role, organizationId) => users.create({
    id, role, organizationId, email: id + '@example.test', passwordHash, fullName: 'Fixture ' + id
  });
  await add('admin', 'ORG_ADMIN', 'local');
  await add('peer', 'ORG_ADMIN', 'local');
  await add('viewer', 'VIEWER', 'local');
  await add('foreign', 'VIEWER', 'foreign');
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  let socket;
  t.after(async () => {
    socket?.disconnect();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    db.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  const root = 'http://127.0.0.1:' + server.address().port;
  async function send(path, status, { method = 'GET', token, body } = {}) {
    const response = await fetch(root + '/api/v1' + path, {
      method, signal: AbortSignal.timeout(3000),
      headers: {
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });
    assert.equal(response.status, status, method + ' ' + path);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    return response.json();
  }
  const login = (id, status = 200, supplied = password) => send('/auth/login', status, {
    method: 'POST', body: { email: id + '@example.test', password: supplied }
  });
  const { accessToken: admin } = await login('admin');
  const { accessToken: first } = await login('viewer');
  const { accessToken: second } = await login('viewer');
  const { accessToken: foreign } = await login('foreign');
  const sid = token => CryptoService.verifyAccessToken(token).sid;
  await send('/auth/sessions', 401);
  const sessions = await send('/auth/sessions', 200, { token: first });
  assert.deepEqual(sessions.data.map(session => [session.id, session.current]).sort(),
    [[sid(first), true], [sid(second), false]].sort());
  assert(sessions.data.every(session => Object.keys(session).sort().join() === 'current,expiresAt,id'));
  await send('/auth/sessions/' + sid(foreign), 404, { method: 'DELETE', token: first });
  await send('/auth/sessions/' + sid(second), 200, { method: 'DELETE', token: first });
  await send('/auth/me', 401, { token: second });

  for (const [path, method] of [
    ['/stations/example/program/hls/playback-link', 'POST'], ['/stations/example/audio/mute', 'POST'],
    ['/stations/example/playout', 'PUT'], ['/stations/example/program/ads', 'GET'],
    ['/stations/example/graphics', 'GET']
  ]) {
    const response = await fetch(root + '/api/v1' + path, { method, headers: { Authorization: 'Bearer ' + first } });
    assert.equal(response.status, 403, method + ' ' + path);
    await response.arrayBuffer();
  }

  await send('/auth/me', 400, { method: 'PATCH', token: first, body: { fullName: 'Changed', role: 'SUPER_ADMIN' } });
  const profile = await send('/auth/me', 200, { method: 'PATCH', token: first, body: { fullName: '  Changed  ' } });
  assert.equal(profile.user.fullName, 'Changed');
  assert.equal(profile.user.role, 'VIEWER');
  assert(!Object.hasOwn(profile.user, 'passwordHash'));
  const status = (id, token, active, expected, currentPassword = password) => send('/users/' + id + '/status', expected, {
    method: 'PATCH', token, body: { currentPassword, active }
  });
  await status('foreign', admin, false, 404);
  await status('peer', admin, false, 404);
  await status('admin', admin, false, 404);
  await status('viewer', first, false, 403);
  await status('viewer', admin, false, 403, secret());

  socket = io(root, { transports: ['websocket'], auth: { token: first }, autoConnect: false, reconnection: false });
  const connected = once(socket, 'connect', { signal: AbortSignal.timeout(3000) });
  socket.connect();
  await connected;
  db.exec(`
    CREATE TRIGGER fixture_reject_deactivate BEFORE INSERT ON audit_logs
    WHEN NEW.action = 'ACCOUNT_DEACTIVATED' BEGIN SELECT RAISE(ABORT, 'fixture audit failure'); END;
  `);
  await status('viewer', admin, false, 500);
  await send('/auth/me', 200, { token: first });
  assert(socket.connected);
  db.exec('DROP TRIGGER fixture_reject_deactivate');
  const disconnected = once(socket, 'disconnect', { signal: AbortSignal.timeout(3000) });
  await status('viewer', admin, false, 200);
  await disconnected;
  await send('/auth/me', 401, { token: first });
  await login('viewer', 401);
  await status('viewer', admin, true, 200);
  await send('/auth/me', 401, { token: first });

  const { accessToken: active } = await login('viewer');
  const { accessToken: other } = await login('viewer');
  const change = (currentPassword, expected) => send('/auth/password', expected, {
    method: 'POST', token: active, body: { currentPassword, newPassword }
  });
  await change(secret(), 403);
  await change(password, 200);
  await send('/auth/me', 401, { token: active });
  await send('/auth/me', 401, { token: other });
  await login('viewer', 401);
  const result = await login('viewer', 200, newPassword);
  assert.equal(result.user.fullName, 'Changed');
  await send('/users/viewer/role', 400, {
    method: 'PATCH', token: admin, body: { currentPassword: password, role: 'ORG_ADMIN' }
  });
  await send('/users/viewer/role', 200, {
    method: 'PATCH', token: admin, body: { currentPassword: password, role: 'OPERATOR' }
  });
  await send('/auth/me', 401, { token: result.accessToken });
  const operator = await login('viewer', 200, newPassword);
  assert.equal(operator.user.role, 'OPERATOR');
  const provision = (email, actor, { role = 'VIEWER', organizationId = 'local' } = {}) => users.create({
    email, role, organizationId, fullName: 'Provisioning fixture', passwordHash
  }, { actor });
  const administrator = { id: 'admin', sessionId: sid(admin), ipAddress: '127.0.0.1' };
  const provisioned = await provision('provisioned@example.test', administrator);
  await assert.rejects(provision(provisioned.email, administrator), { status: 409 });
  await assert.rejects(provision('revoked@example.test', {
    ...administrator, sessionId: 'missing-session'
  }), { status: 403 });
  await assert.rejects(provision('operator-attempt@example.test', {
    id: 'viewer', sessionId: sid(operator.accessToken), ipAddress: '127.0.0.1'
  }), { status: 403 });
  await assert.rejects(provision('foreign-attempt@example.test', administrator, { organizationId: 'foreign' }), { status: 403 });
  await assert.rejects(provision('root-attempt@example.test', administrator, { role: 'SUPER_ADMIN' }), { status: 403 });
  assert.equal(await users.findByEmail('revoked@example.test'), null);
  assert.equal(await users.findByEmail('operator-attempt@example.test'), null);
  assert.equal(await users.findByEmail('foreign-attempt@example.test'), null);
  assert.equal(await users.findByEmail('root-attempt@example.test'), null);
  assert.equal(db.prepare("SELECT count(*) AS count FROM audit_logs WHERE action = 'USER_CREATED'").get().count, 1);
  assert.deepEqual(db.prepare(`
    SELECT action, userId FROM audit_logs WHERE resourceId = 'viewer'
      AND action IN ('PROFILE_UPDATED', 'ACCOUNT_DEACTIVATED', 'ACCOUNT_ACTIVATED', 'PASSWORD_CHANGED', 'ACCOUNT_ROLE_CHANGED')
    ORDER BY rowid
  `).all().map(row => [row.action, row.userId]), [
    ['PROFILE_UPDATED', 'viewer'], ['ACCOUNT_DEACTIVATED', 'admin'],
    ['ACCOUNT_ACTIVATED', 'admin'], ['PASSWORD_CHANGED', 'viewer'], ['ACCOUNT_ROLE_CHANGED', 'admin']
  ]);
});
