import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const directory = mkdtempSync(join(tmpdir(), 'mcr-ticker-'));
const secret = () => randomBytes(32).toString('hex');
Object.assign(process.env, {
  NODE_ENV: 'test', STORAGE_MODE: 'sqlite', SQLITE_DB_PATH: join(directory, 'fixture.sqlite'),
  PORT: '25700', MCR_BIND_HOST: '127.0.0.1', MCR_PROGRAM_RUNTIME_PORT: '25701',
  MCR_PROGRAM_INPUT_HOST: '127.0.0.1', MCR_PROGRAM_INPUT_PORT: '25702', MCR_PROGRAM_OUTPUT_PORT: '25703',
  MCR_PROGRAM_SLATE: 'blue', MCR_PROGRAM_INPUT_URL: '', MCR_PROGRAM_SECOND_INPUT_PORT: '',
  MCR_PROGRAM_SRT_URL: '', MCR_PROGRAM_SRT_PASSPHRASE: '', MCR_PROGRAM_RECORDING_DIR: '',
  MCR_PROGRAM_AUTOSTART: '0', JWT_SECRET: secret(), REFRESH_TOKEN_SECRET: secret(), ENCRYPTION_MASTER_KEY: secret()
});
const { RepositoryFactory } = await import('../src/infrastructure/repositories/repository-factory.js');
const { CryptoService } = await import('../src/infrastructure/security/crypto-service.js');
const { createSession } = await import('../src/infrastructure/security/session-service.js');
const station = await RepositoryFactory.getStationRepository().create({
  name: 'Ticker fixture', organizationId: 'fixture', encryptedPassword: 'unused'
});
const operator = await RepositoryFactory.getUserRepository().create({
  email: 'ticker@fixture.local', fullName: 'Operator', passwordHash: 'unused', role: 'OPERATOR', organizationId: 'fixture'
});
const token = CryptoService.signAccessToken({ sub: operator.id, sid: createSession(operator.id).id });
process.env.MCR_PROGRAM_STATION_ID = station.id;
const root = 'http://127.0.0.1:25700/api/v1/stations/' + station.id + '/program';
const request = (suffix = '', method = 'GET', body, authorized = true) => fetch(root + suffix, {
  method, headers: { ...(authorized && { Authorization: 'Bearer ' + token }), 'Content-Type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body)
});
async function call(suffix, method, body) {
  const response = await request(suffix, method, body);
  assert.equal(response.status, 200, await response.clone().text());
  return (await response.json()).data;
}
async function waitFor(predicate) {
  const deadline = Date.now() + 20000;
  while (!await predicate()) {
    if (Date.now() > deadline) throw new Error('Ticker fixture timed out');
    await sleep(80);
  }
}
const start = script => spawn(process.execPath, [script], {
  env: { ...process.env, NODE_ENV: 'development' }, windowsHide: true, stdio: 'inherit'
});
async function stop(child) {
  if (child && child.exitCode === null && child.signalCode === null) {
    const closed = once(child, 'close');
    child.kill();
    await closed;
  }
}
const runtime = start('backend/src/program-runtime.js');
const api = start('backend/src/index.js');
let decoder;
let frame = null;
const centers = new Set();
try {
  await waitFor(() => request('/ticker', 'GET', undefined, false).then(r => r.status === 401).catch(() => false));
  decoder = spawn(process.env.FFMPEG_PATH || 'ffmpeg', [
    '-nostdin', '-loglevel', 'error', '-i', 'udp://127.0.0.1:25703',
    '-map', '0:v', '-vf', 'crop=1280:44:0:676,scale=320:11', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1'
  ], { windowsHide: true, stdio: ['ignore', 'pipe', 'inherit'] });
  let buffered = Buffer.alloc(0);
  const frameSize = 320 * 11 * 3;
  decoder.stdout.on('data', chunk => {
    buffered = Buffer.concat([buffered, chunk]);
    while (buffered.length >= frameSize) {
      frame = buffered.subarray(0, frameSize);
      buffered = buffered.subarray(frameSize);
      let count = 0;
      let total = 0;
      for (let i = 0; i < frameSize; i += 3) {
        if (frame[i] > 150 && frame[i + 1] > 150 && frame[i + 2] > 150) {
          total += (i / 3) % 320;
          count++;
        }
      }
      if (count > 10) centers.add(Math.round(total / count));
    }
  });
  const initial = await call('', 'POST', { action: 'start' });
  const blue = () => frame && frame[2] > 150 && frame[0] < 50;
  await waitFor(blue);
  const settings = { enabled: true, text: 'أخبار عاجلة | Headlines & <updates>', speed: 280, direction: 'left' };
  const applied = await call('/ticker', 'PUT', { revision: 0, ...settings });
  assert.deepEqual(await call('/ticker'), applied);
  assert.equal((await request('/ticker', 'PUT', { revision: 0, ...settings })).status, 409);
  await waitFor(() => centers.size > 15);
  assert.equal((await call('')).session, initial.session);
  await call('/ticker', 'PUT', { revision: applied.revision, ...settings, enabled: false });
  await waitFor(blue);
  assert.equal((await call('')).session, initial.session);
  console.log('Ticker motion and disable verified on decoded Program');
} finally {
  await request('', 'POST', { action: 'stop' }).catch(() => {});
  await Promise.all([stop(decoder), stop(api), stop(runtime)]);
}
