import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

function loadConfig(overrides) {
  const config = new URL('../src/config/env.js', import.meta.url).href;
  return spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(config)})`], {
    encoding: 'utf8',
    env: {
      ...process.env, NODE_ENV: 'development', MCR_BIND_HOST: '127.0.0.1',
      JWT_SECRET: '', REFRESH_TOKEN_SECRET: '', ENCRYPTION_MASTER_KEY: '', MCR_ADMIN_PASSWORD: '',
      MCR_TRUST_PROXY_CIDRS: '', STORAGE_MODE: 'sqlite', DATABASE_URL: '', ...overrides
    }
  });
}

test('MCR rejects unsupported storage before opening a database', () => {
  const databaseUrl = 'mysql://fixture-user:fixture-password@database.example.test/fixture';
  for (const overrides of [
    { STORAGE_MODE: 'mysql' }, { STORAGE_MODE: '', DATABASE_URL: databaseUrl }, { STORAGE_MODE: 'unknown' }
  ]) {
    const result = loadConfig(overrides);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /runtime supports only SQLite/);
    assert(!result.stderr.includes(databaseUrl));
  }
  assert.equal(loadConfig({ DATABASE_URL: databaseUrl }).status, 0);
});

test('MCR validates explicit trusted proxy addresses at startup', () => {
  assert.equal(loadConfig({ MCR_TRUST_PROXY_CIDRS: '192.0.2.0/24, 2001:db8::1' }).status, 0);
  for (const value of ['192.0.2.1/33', '::/0', 'proxy.example.test', '127.0.0.1,']) {
    const result = loadConfig({ MCR_TRUST_PROXY_CIDRS: value });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /MCR_TRUST_PROXY_CIDRS must list IP addresses/);
  }
});

test('MCR rejects missing secrets in production and when bound to the network', () => {
  for (const overrides of [{ NODE_ENV: 'production' }, { MCR_BIND_HOST: '0.0.0.0' }]) {
    const result = loadConfig(overrides);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Set a private JWT_SECRET/);
  }
});

test('MCR accepts local development and production with independent private secrets', () => {
  assert.equal(loadConfig({}).status, 0);
  const generate = () => randomBytes(32).toString('hex');
  const result = loadConfig({
    NODE_ENV: 'production', JWT_SECRET: generate(),
    REFRESH_TOKEN_SECRET: generate(), ENCRYPTION_MASTER_KEY: generate(),
    CORS_ORIGIN: 'https://mcr.example.test'
  });
  assert.equal(result.status, 0, result.stderr);
});

test('Render refuses a persistent SQLite configuration outside the configured mount', () => {
  const result = loadConfig({
    RENDER: 'true',
    MCR_RENDER_DISK_MOUNT: '/var/data/mcr',
    SQLITE_DB_PATH: '/tmp/pallcom-mcr/mcr.sqlite'
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /SQLITE_DB_PATH must be below MCR_RENDER_DISK_MOUNT/);
});

test('Network-bound MCR rejects a legacy administrator bootstrap password and reused keys', () => {
  const keys = () => ({
    JWT_SECRET: randomBytes(32).toString('hex'),
    REFRESH_TOKEN_SECRET: randomBytes(32).toString('hex'),
    ENCRYPTION_MASTER_KEY: randomBytes(32).toString('hex')
  });
  const privateKeys = keys();
  const shared = loadConfig({ MCR_BIND_HOST: '0.0.0.0', ...privateKeys,
    JWT_SECRET: privateKeys.ENCRYPTION_MASTER_KEY });
  assert.equal(shared.status, 1);
  assert.match(shared.stderr, /must be distinct/);

  const legacy = ['Admin', '123456', '!'].join('');
  const password = loadConfig({ MCR_BIND_HOST: '0.0.0.0', ...keys(), MCR_ADMIN_PASSWORD: legacy });
  assert.equal(password.status, 1);
  assert.match(password.stderr, /Set a private MCR_ADMIN_PASSWORD/);
  assert(!password.stderr.includes(legacy));
});
