import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import test from 'node:test';

test('password recovery uses generic responses and a hashed expiring single-use grant', { timeout: 15000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'mcr-recovery-api-'));
  const secret = () => randomBytes(32).toString('hex');
  const key = secret();
  const delivered = [];
  const delivery = createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/reset' || req.headers.authorization !== 'Bearer ' + key) {
      res.writeHead(401).end();
      return;
    }
    const buffers = [];
    for await (const chunk of req) buffers.push(chunk);
    delivered.push(JSON.parse(Buffer.concat(buffers).toString()));
    res.writeHead(204).end();
  });
  delivery.listen(0, '127.0.0.1');
  await once(delivery, 'listening');
  t.after(async () => {
    delivery.closeAllConnections();
    await new Promise(resolve => delivery.close(resolve));
  });
  Object.assign(process.env, {
    NODE_ENV: 'test', STORAGE_MODE: 'sqlite', SQLITE_DB_PATH: join(directory, 'fixture.sqlite'),
    JWT_SECRET: secret(), REFRESH_TOKEN_SECRET: secret(), ENCRYPTION_MASTER_KEY: secret(),
    CORS_ORIGIN: 'https://fixture.example.test',
    MCR_PASSWORD_RESET_DELIVERY_URL: 'http://127.0.0.1:' + delivery.address().port + '/reset',
    MCR_PASSWORD_RESET_DELIVERY_KEY: key
  });
  const { server } = await import('../src/index.js');
  const { getSqliteDatabase } = await import('../src/infrastructure/database/sqlite.js');
  const { SqliteUserRepository } = await import('../src/infrastructure/repositories/sqlite-user-repository.js');
  const { CryptoService } = await import('../src/infrastructure/security/crypto-service.js');
  const db = getSqliteDatabase();
  const password = secret();
  const newPassword = secret();
  const email = 'viewer@example.test';
  const users = new SqliteUserRepository();
  const passwordHash = await CryptoService.hashPassword(password);
  const user = await users.create({ email, passwordHash, fullName: 'Viewer', role: 'VIEWER', organizationId: 'local' });
  await users.create({ email: 'inactive@example.test', passwordHash, fullName: 'Inactive', isActive: false });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    db.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  const root = 'http://127.0.0.1:' + server.address().port + '/api/v1/auth';
  const send = (path, body) => fetch(root + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(3000)
  });
  async function forgot(requestedEmail) {
    const response = await send('/password/forgot', { email: requestedEmail });
    assert.equal(response.status, 202);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(await response.json(), { success: true });
  }
  async function waitForGrant(index) {
    for (let attempt = 0; attempt < 30 && !delivered[index]; attempt++) await sleep(30);
    const message = delivered[index];
    assert(message, 'Fixture delivery expected');
    assert.equal(message.email, email);
    const url = new URL(message.resetUrl);
    assert.equal(url.origin, 'https://fixture.example.test');
    assert.equal(url.search, '');
    return url.hash.slice('#reset='.length);
  }
  const originalLogin = await send('/login', { email, password });
  assert.equal(originalLogin.status, 200);
  const { accessToken } = await originalLogin.json();
  await forgot('missing@example.test');
  await forgot('inactive@example.test');
  await forgot(email);
  const expired = await waitForGrant(0);
  const row = db.prepare('SELECT tokenHash, expiresAt FROM password_reset_grants WHERE userId = ?').get(user.id);
  assert.equal(row.tokenHash, CryptoService.hashToken(expired));
  assert(row.expiresAt > Date.now());
  db.prepare('UPDATE password_reset_grants SET expiresAt = 0 WHERE userId = ?').run(user.id);
  assert.equal((await send('/password/reset', { token: expired, newPassword })).status, 400);

  await forgot(email);
  const token = await waitForGrant(1);
  assert.notEqual(expired, token);
  const attempts = await Promise.all([
    send('/password/reset', { token, newPassword }), send('/password/reset', { token, newPassword })
  ]);
  assert.deepEqual(attempts.map(response => response.status).sort(), [200, 400]);
  assert.equal((await send('/password/reset', { token, newPassword })).status, 400);
  assert.equal(db.prepare('SELECT count(*) AS count FROM password_reset_grants').get().count, 0);
  assert.equal(db.prepare("SELECT count(*) AS count FROM audit_logs WHERE action = 'PASSWORD_RESET' AND userId = ?")
    .get(user.id).count, 1);
  assert.equal((await fetch(root + '/me', { headers: { Authorization: 'Bearer ' + accessToken } })).status, 401);
  assert.equal((await send('/login', { email, password })).status, 401);
  assert.equal((await send('/login', { email, password: newPassword })).status, 200);
  assert.equal(delivered.length, 2);
});
