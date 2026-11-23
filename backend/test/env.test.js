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
      JWT_SECRET: '', REFRESH_TOKEN_SECRET: '', ENCRYPTION_MASTER_KEY: '', ...overrides
    }
  });
}

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
