import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm, rmdir } from 'node:fs/promises';
import { createServer, request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

test('production HTTP serves the dashboard content security policy', { timeout: 10000 }, async context => {
  const directory = await mkdtemp(join(tmpdir(), 'mcr-production-headers-'));
  const databasePath = join(directory, 'fixture.sqlite');
  const privateKey = () => randomBytes(32).toString('hex');
  Object.assign(process.env, {
    NODE_ENV: 'production', RENDER: 'false', PORT: '0', MCR_BIND_HOST: '127.0.0.1',
    CORS_ORIGIN: 'https://mcr.example.test', MCR_PROGRAM_RUNTIME_PORT: '', MCR_ADMIN_PASSWORD: '',
    STORAGE_MODE: 'sqlite', SQLITE_DB_PATH: databasePath,
    JWT_SECRET: privateKey(), REFRESH_TOKEN_SECRET: privateKey(), ENCRYPTION_MASTER_KEY: privateKey(),
    LOG_LEVEL: 'silent', MCR_TRUST_PROXY: '1', MCR_TRUST_PROXY_CIDRS: '192.0.2.0/24, 2001:db8::1'
  });
  const { app, server } = await import('../src/index.js');
  const { getSqliteDatabase } = await import('../src/infrastructure/database/sqlite.js');
  context.after(async () => {
    await new Promise(resolve => server.close(resolve));
    getSqliteDatabase().close();
    await rm(databasePath, { force: true });
    await rmdir(directory);
  });
  if (!server.address()) await once(server, 'listening');

  assert.equal(server.headersTimeout, 30_000);
  assert.equal(server.requestTimeout, 300_000);
  assert.equal(server.connectionsCheckingInterval, 5_000);
  const trustProxy = app.get('trust proxy fn');
  assert.equal(trustProxy('192.0.2.1', 0), true);
  assert.equal(trustProxy('2001:db8::1', 0), true);
  assert.equal(trustProxy('198.51.100.1', 0), false);
  assert.equal(trustProxy('2001:db8::2', 0), false);

  const response = await fetch(`http://127.0.0.1:${server.address().port}/health`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, 'ok');
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.match(response.headers.get('Strict-Transport-Security'), /max-age=[1-9][0-9]*/);
  const directives = new Map(response.headers.get('Content-Security-Policy').split(';').map(directive => {
    const [name, ...values] = directive.trim().split(/\s+/);
    return [name, values];
  }));
  assert.deepEqual(directives.get('default-src'), ["'self'"]);
  assert.deepEqual(directives.get('script-src'), ["'self'"]);
  assert.deepEqual(directives.get('script-src-attr'), ["'none'"]);
  assert.deepEqual(directives.get('object-src'), ["'none'"]);
  assert.deepEqual(directives.get('style-src'), ["'self'", 'https://fonts.googleapis.com', "'unsafe-inline'"]);
  assert.deepEqual(directives.get('font-src'), ["'self'", 'https://fonts.gstatic.com']);
  assert.deepEqual(directives.get('media-src'), ["'self'"]);
  assert.deepEqual(directives.get('connect-src'), ["'self'", 'wss://mcr.example.test']);

  const { RepositoryFactory } = await import('../src/infrastructure/repositories/repository-factory.js');
  const { CryptoService } = await import('../src/infrastructure/security/crypto-service.js');
  const email = 'proxy-fixture@mcr.local';
  const password = privateKey();
  const account = await RepositoryFactory.getUserRepository().create({
    email, passwordHash: await CryptoService.hashPassword(password), fullName: 'Fixture Operator',
    role: 'OPERATOR', organizationId: 'proxy-fixture'
  });
  const forwardedClient = '198.51.100.8';
  const proxy = createServer((req, res) => {
    const upstream = request({
      hostname: '127.0.0.1', port: server.address().port, method: req.method, path: '/api/v1/auth/login',
      headers: {
        'Content-Type': req.headers['content-type'], 'Content-Length': req.headers['content-length'],
        'X-Forwarded-For': forwardedClient
      }
    }, forwarded => {
      res.writeHead(forwarded.statusCode, forwarded.headers);
      forwarded.pipe(res);
    });
    upstream.on('error', error => res.destroy(error));
    req.pipe(upstream);
  });
  proxy.listen(0, '127.0.0.1');
  await once(proxy, 'listening');
  try {
    const login = () => fetch(`http://127.0.0.1:${proxy.address().port}/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const auditIPs = getSqliteDatabase().prepare(`SELECT ipAddress FROM audit_logs
      WHERE userId = ? AND action = 'LOGIN_SUCCESS' ORDER BY rowid`);
    const firstLogin = await login();
    assert.equal(firstLogin.status, 200);
    await firstLogin.text();
    assert.deepEqual(auditIPs.all(account.id).map(event => event.ipAddress), ['127.0.0.1']);

    app.set('trust proxy', ['127.0.0.1']);
    const secondLogin = await login();
    assert.equal(secondLogin.status, 200);
    await secondLogin.text();
    assert.deepEqual(auditIPs.all(account.id).map(event => event.ipAddress), ['127.0.0.1', forwardedClient]);
  } finally {
    await new Promise(resolve => proxy.close(resolve));
  }
});
