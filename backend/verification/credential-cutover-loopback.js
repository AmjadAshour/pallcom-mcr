import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeFixtureProcess } from './close-fixture-process.js';

const project = fileURLToPath(new URL('../../', import.meta.url));
const directory = await mkdtemp(join(tmpdir(), 'mcr-cutover-'));
const secret = () => randomBytes(32).toString('hex');
const password = secret();
const keySet = () => ({ JWT_SECRET: secret(), REFRESH_TOKEN_SECRET: secret() });
const original = keySet();
const replacement = keySet();
const encryption = secret();
const email = 'admin@mcrpro.local';
let child;

async function boot(keys) {
  child = spawn(process.execPath, ['--input-type=module', '--eval', `
    import { once } from 'node:events';
    const { server } = await import('./backend/src/index.js');
    if (!server.address()) await once(server, 'listening');
    process.send(server.address().port);
  `], {
    cwd: project,
    env: { ...process.env, ...keys, ENCRYPTION_MASTER_KEY: encryption, NODE_ENV: 'production',
      RENDER: 'false', MCR_BIND_HOST: '127.0.0.1', PORT: '0', CORS_ORIGIN: 'https://127.0.0.1',
      STORAGE_MODE: 'sqlite', SQLITE_DB_PATH: join(directory, 'cutover.sqlite'), MCR_ADMIN_PASSWORD: password,
      MCR_PREVIOUS_ADMIN_PASSWORD: '', MCR_PROGRAM_RUNTIME_PORT: '', MCR_PROGRAM_STATION_ID: '', LOG_LEVEL: 'silent' },
    stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
    windowsHide: true,
  });
  const [port] = await once(child, 'message', { signal: AbortSignal.timeout(8000) });
  return 'http://127.0.0.1:' + port;
}

const send = (origin, path, options = {}) => fetch(origin + '/api/v1' + path, {
  ...options, signal: AbortSignal.timeout(4000)
});
const json = body => ({
  method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' }
});
async function login(origin, waitForBootstrap = false) {
  const deadline = Date.now() + 3500;
  do {
    const response = await send(origin, '/auth/login', json({ email, password }));
    if (response.status === 200) return response;
    await response.arrayBuffer();
    if (!waitForBootstrap || response.status !== 401) return response;
    await new Promise(resolve => setTimeout(resolve, 250));
  } while (Date.now() < deadline);
  throw new Error('Disposable bootstrap account was not ready');
}
const bearer = accessToken => ({ headers: { Authorization: 'Bearer ' + accessToken } });

try {
  let origin = await boot(original);
  const firstLogin = await login(origin, true);
  assert.equal(firstLogin.status, 200);
  const { accessToken: oldAccess, user } = await firstLogin.json();
  const oldRefresh = firstLogin.headers.getSetCookie()
    .find(cookie => cookie.startsWith('mcr_refresh_token='))?.split(';')[0].slice('mcr_refresh_token='.length);
  assert(oldAccess && oldRefresh);
  assert.equal((await send(origin, '/auth/me', bearer(oldAccess))).status, 200);
  await closeFixtureProcess(child, 'Original signing-key server');

  origin = await boot(replacement);
  assert.equal((await send(origin, '/auth/me', bearer(oldAccess))).status, 401);
  assert.equal((await send(origin, '/auth/refresh', json({ refreshToken: oldRefresh }))).status, 401);
  const renewed = await login(origin);
  assert.equal(renewed.status, 200);
  const result = await renewed.json();
  assert.equal(result.user.id, user.id);
  assert.equal((await send(origin, '/auth/me', bearer(result.accessToken))).status, 200);
  console.log('Disposable signing-key cutover rejected old sessions and preserved account access');
} finally {
  await closeFixtureProcess(child, 'Signing-key server');
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
