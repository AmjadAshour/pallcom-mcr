import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { base32, totpCode } from '../src/infrastructure/security/totp.js';

test('TOTP matches RFC 6238 SHA-1 test vectors', () => {
  const secret = Buffer.from('12345678901234567890');
  assert.equal(base32(secret), 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  assert.equal(totpCode(secret, Math.floor(59 / 30), 8), '94287082');
  assert.equal(totpCode(secret, Math.floor(1111111109 / 30), 8), '07081804');
});

test('optional MFA protects new sessions and consumes verification and recovery codes once', { timeout: 15000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'mcr-mfa-'));
  const secret = () => randomBytes(32).toString('hex');
  Object.assign(process.env, {
    NODE_ENV: 'test', STORAGE_MODE: 'sqlite', SQLITE_DB_PATH: join(directory, 'fixture.sqlite'),
    JWT_SECRET: secret(), REFRESH_TOKEN_SECRET: secret(), ENCRYPTION_MASTER_KEY: secret()
  });
  const now = Date.now;
  Date.now = () => 1800000000000;
  t.after(() => { Date.now = now; });
  const { server } = await import('../src/index.js');
  const { getSqliteDatabase } = await import('../src/infrastructure/database/sqlite.js');
  const { SqliteUserRepository } = await import('../src/infrastructure/repositories/sqlite-user-repository.js');
  const { CryptoService } = await import('../src/infrastructure/security/crypto-service.js');
  const db = getSqliteDatabase();
  const password = secret();
  const email = 'mfa@example.test';
  const user = await new SqliteUserRepository().create({
    email, passwordHash: await CryptoService.hashPassword(password), fullName: 'MFA fixture', role: 'VIEWER'
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    db.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  const root = 'http://127.0.0.1:' + server.address().port + '/api/v1/auth';
  async function post(path, body, status, token) {
    const response = await fetch(root + path, {
      method: 'POST', body: JSON.stringify(body), signal: AbortSignal.timeout(3000),
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }
    });
    assert.equal(response.status, status, path);
    return response.json();
  }
  const login = (secondFactor, status) => post('/login', { email, password, secondFactor }, status);
  const me = token => fetch(root + '/me', { headers: { Authorization: 'Bearer ' + token } });
  const { accessToken: first } = await login(undefined, 200);
  await post('/mfa/enroll', { currentPassword: secret() }, 403, first);
  const setup = await post('/mfa/enroll', { currentPassword: password }, 200, first);
  const factor = db.prepare('SELECT encryptedSecret FROM auth_mfa WHERE userId = ?').get(user.id).encryptedSecret;
  const key = Buffer.from(CryptoService.decryptSecret(factor), 'hex');
  assert.equal(base32(key), setup.secret);
  assert(!factor.includes(key.toString('hex')));
  const step = Math.floor(Date.now() / 30000);
  const enrollmentCode = totpCode(key, step - 1);
  const currentCode = totpCode(key, step);
  const confirmed = await post('/mfa/confirm', { currentPassword: password, secondFactor: enrollmentCode }, 200, first);
  assert.equal(confirmed.recoveryCodes.length, 8);
  const storedCodes = db.prepare('SELECT codeHash FROM auth_mfa_recovery_codes WHERE userId = ?').all(user.id);
  assert.deepEqual(storedCodes.map(row => row.codeHash).sort(), confirmed.recoveryCodes.map(CryptoService.hashToken).sort());
  assert.equal((await me(first)).status, 401);
  assert.equal((await login(undefined, 401)).details, 'second-factor-required');
  await login(enrollmentCode, 401);
  const { accessToken: second } = await login(currentCode, 200);
  await login(currentCode, 401);
  const { accessToken: recovered } = await login(confirmed.recoveryCodes[0], 200);
  await login(confirmed.recoveryCodes[0], 401);
  await post('/mfa/disable', { currentPassword: password, secondFactor: confirmed.recoveryCodes[0] }, 403, recovered);
  await post('/mfa/disable', { currentPassword: password, secondFactor: confirmed.recoveryCodes[1] }, 200, recovered);
  assert.equal((await me(second)).status, 401);
  assert.equal((await me(recovered)).status, 401);
  await login(undefined, 200);
});
