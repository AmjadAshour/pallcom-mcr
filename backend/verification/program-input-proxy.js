import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const station = 'program-proxy-fixture';
const proxy = createServer();
let observeConnection;
const observed = new Promise(resolve => { observeConnection = resolve; });
proxy.on('connect', (request, socket) => {
  observeConnection(request.url);
  socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
});
proxy.listen(0, '127.0.0.1');
await once(proxy, 'listening');

const secret = () => randomBytes(32).toString('hex');
Object.assign(process.env, {
  NODE_ENV: 'test', STORAGE_MODE: 'sqlite', MCR_BIND_HOST: '0.0.0.0',
  SQLITE_DB_PATH: join(mkdtempSync(join(tmpdir(), 'mcr-proxy-fixture-')), 'fixture.sqlite'),
  JWT_SECRET: secret(), REFRESH_TOKEN_SECRET: secret(), ENCRYPTION_MASTER_KEY: secret(),
  MCR_ADMIN_PASSWORD: '', MCR_PROGRAM_STATION_ID: station,
  MCR_PROGRAM_INPUT_HOST: '127.0.0.1', MCR_PROGRAM_INPUT_PORT: '25461', MCR_PROGRAM_OUTPUT_PORT: '25462',
  MCR_PROGRAM_INPUT_URL: 'https://source.example.test/feed?fixture=synthetic-source-marker',
  MCR_PROGRAM_INPUT_EGRESS_PROXY: 'http://127.0.0.1:' + proxy.address().port,
  MCR_PROGRAM_HLS_DIR: '', MCR_PROGRAM_RECORDING_DIR: '',
  MCR_PROGRAM_SRT_URL: '', MCR_PROGRAM_SECOND_SRT_URL: '', MCR_PROGRAM_SECOND_INPUT_PORT: ''
});

const { programAction, programStatus } = await import('../src/infrastructure/program/supervisor.js');
let timer;
try {
  const requestedHost = Promise.race([
    observed,
    new Promise((_, reject) => { timer = setTimeout(() => reject(Error('No connection reached the local proxy')), 15000); })
  ]);
  const [, address] = await Promise.all([programAction(station, 'start'), requestedHost]);
  assert.equal(address, 'source.example.test:443');
  const status = programStatus(station);
  assert.equal(status.state, 'running');
  assert.equal(status.source, 'fallback');
  assert(!JSON.stringify(status).includes('synthetic-source-marker'));
  console.log('HTTPS contribution used the local proxy and stayed on slate after denial');
} finally {
  clearTimeout(timer);
  await programAction(station, 'stop').finally(() => proxy.close());
}
