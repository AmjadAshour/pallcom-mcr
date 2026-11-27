import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { closeFixtureProcess } from './close-fixture-process.js';

const [databasePath, expectedLoginCount] = process.argv.slice(2);
const password = process.env.MCR_RESTORE_TEST_PASSWORD;
const userId = 'restored-fixture-user';
const email = 'restore-fixture@example.invalid';
const organizationId = 'fixture-org';
assert(databasePath && /^[12]$/.test(expectedLoginCount));
assert.match(password ?? '', /^[0-9a-f]{64}$/);

const database = new DatabaseSync(databasePath, { readOnly: true });
let child;
try {
  const user = database.prepare('SELECT email, organizationId FROM users WHERE id = ?').get(userId);
  assert.equal(user?.email, email);
  assert.equal(user.organizationId, organizationId);
  child = spawn(process.execPath, ['--input-type=module', '--eval', `
    import { once } from 'node:events';
    const { server } = await import('./backend/src/index.js');
    if (!server.address()) await once(server, 'listening');
    process.send(server.address().port);
  `], {
    cwd: fileURLToPath(new URL('../../', import.meta.url)),
    env: {
      ...process.env, NODE_ENV: 'production', RENDER: 'false', PORT: '0', LOG_LEVEL: 'silent',
      MCR_BIND_HOST: '127.0.0.1', CORS_ORIGIN: 'https://127.0.0.1', STORAGE_MODE: 'sqlite',
      SQLITE_DB_PATH: databasePath, MCR_ADMIN_PASSWORD: '', MCR_PREVIOUS_ADMIN_PASSWORD: '',
      MCR_PROGRAM_STATION_ID: '', MCR_PROGRAM_RUNTIME_PORT: '', MCR_RESTORE_TEST_PASSWORD: ''
    },
    stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
    windowsHide: true,
  });
  const [port] = await once(child, 'message', { signal: AbortSignal.timeout(8000) });
  const request = (path, options) => fetch('http://127.0.0.1:' + port + '/api/v1' + path, {
    ...options, signal: AbortSignal.timeout(4000)
  });

  const login = await request('/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  assert.equal(login.status, 200);
  const result = await login.json();
  assert.equal(result.user.id, userId);
  assert.equal(result.user.organizationId, organizationId);
  assert(result.accessToken);
  const auth = { headers: { Authorization: 'Bearer ' + result.accessToken } };
  const station = await request('/stations/fixture', auth);
  assert.equal(station.status, 200);
  const { data } = await station.json();
  assert.equal(data.id, 'fixture');
  assert.equal(data.name, 'After restore');
  assert.equal(data.organizationId, organizationId);
  const foreign = await request('/stations/foreign-fixture', auth);
  assert.equal(foreign.status, 404);
  await foreign.arrayBuffer();
  const loginAudit = database.prepare(
    "SELECT count(*) AS count FROM audit_logs WHERE userId = ? AND organizationId = ? AND action = 'LOGIN_SUCCESS'"
  ).get(userId, organizationId);
  assert.equal(loginAudit.count, Number(expectedLoginCount));
  console.log('Restored API login, station scope and persisted audit passed for run ' + expectedLoginCount);
} finally {
  database.close();
  await closeFixtureProcess(child, 'Restored API server');
}
