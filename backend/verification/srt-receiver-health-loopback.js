/** Exercise receiver reports against the real station API and GStreamer Program. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import express from 'express';

const secret = () => randomBytes(32).toString('hex');
const receiverToken = secret();
const secondaryToken = secret();
const passphrase = randomBytes(20).toString('hex');
Object.assign(process.env, {
  NODE_ENV: 'test', STORAGE_MODE: 'sqlite',
  SQLITE_DB_PATH: join(mkdtempSync(join(tmpdir(), 'mcr-srt-receiver-')), 'fixture.sqlite'),
  JWT_SECRET: secret(), REFRESH_TOKEN_SECRET: secret(), ENCRYPTION_MASTER_KEY: secret(),
  MCR_PROGRAM_INPUT_URL: '', MCR_PROGRAM_SECOND_INPUT_PORT: '', MCR_PROGRAM_AUTO_BACKUP: '0',
  MCR_PROGRAM_RECORDING_DIR: '', MCR_PROGRAM_SLATE: 'blue',
  MCR_PROGRAM_INPUT_PORT: '25510', MCR_PROGRAM_OUTPUT_PORT: '25512',
  MCR_PROGRAM_SRT_URL: 'srt://127.0.0.1:25514?mode=caller',
  MCR_PROGRAM_SRT_PASSPHRASE: passphrase, MCR_PROGRAM_SRT_RECEIVER_TOKEN: receiverToken,
  MCR_PROGRAM_SECOND_SRT_URL: '', MCR_PROGRAM_SECOND_SRT_PASSPHRASE: '',
  MCR_PROGRAM_SECOND_SRT_RECEIVER_TOKEN: secondaryToken,
});
const { RepositoryFactory: repo } = await import('../src/infrastructure/repositories/repository-factory.js');
const { CryptoService } = await import('../src/infrastructure/security/crypto-service.js');
const { createSession } = await import('../src/infrastructure/security/session-service.js');
const { apiRouter } = await import('../src/presentation/routes/index.js');
const { programAction } = await import('../src/infrastructure/program/supervisor.js');
const { forwardProgram } = await import('../src/infrastructure/program/runtime-proxy.js');
const station = await repo.getStationRepository().create({
  name: 'Receiver fixture', organizationId: 'receiver-fixture', encryptedPassword: 'unused',
});
process.env.MCR_PROGRAM_STATION_ID = station.id;
const user = await repo.getUserRepository().create({
  email: 'receiver@fixture.local', fullName: 'Receiver fixture operator', passwordHash: 'unused',
  role: 'STUDIO_MANAGER', organizationId: 'receiver-fixture',
});
const operatorToken = CryptoService.signAccessToken({ sub: user.id, sid: createSession(user.id).id });
const app = express();
app.use(express.json({ limit: '100kb' }));
app.use('/api/v1', apiRouter);
const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
const web = express();
web.use(forwardProgram(server.address().port));
const proxy = web.listen(0, '127.0.0.1');
await once(proxy, 'listening');
const base = 'http://127.0.0.1:' + proxy.address().port + '/api/v1/stations/';
const program = base + station.id + '/program';
const report = (token, destination = 'primary', tracks = { video: true, audio: true }, id = station.id) =>
  fetch(base + id + '/program/receivers/' + destination, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(tracks),
  });
async function status() {
  const response = await fetch(program, { headers: { Authorization: 'Bearer ' + operatorToken } });
  assert.equal(response.status, 200);
  const payload = await response.text();
  for (const secret of [receiverToken, secondaryToken, passphrase]) assert(!payload.includes(secret));
  return JSON.parse(payload).data;
}
async function until(label, expected, session) {
  const deadline = Date.now() + 24000;
  do {
    const current = await status();
    assert.equal(current.session, session);
    if (current.srtDestinations[0].receiver === expected) {
      console.log(label);
      return;
    }
    await sleep(150);
  } while (Date.now() < deadline);
  assert.fail(label + ': ' + JSON.stringify(await status()));
}
const probeScript = fileURLToPath(new URL('../src/infrastructure/program/srt-receiver.py', import.meta.url));
let probe;
function startProbe() {
  probe = spawn(process.env.MCR_PROGRAM_PYTHON || 'python', ['-u', probeScript], {
    windowsHide: true, stdio: 'inherit',
    env: { ...process.env, MCR_SRT_RECEIVER_URL: 'srt://127.0.0.1:25514?mode=listener&pbkeylen=32&passphrase=' + passphrase,
      MCR_SRT_RECEIVER_REPORT_URL: program + '/receivers/primary', MCR_SRT_RECEIVER_TOKEN: receiverToken },
  });
}
async function stopProbe() {
  if (!probe || probe.exitCode !== null || probe.signalCode !== null) return;
  const closed = once(probe, 'close');
  probe.kill();
  await closed;
}
try {
  assert.equal((await report(receiverToken)).status, 409);
  const { session } = await programAction(station.id, 'start');
  await until('Waiting for an authenticated report', 'waiting', session);
  assert.equal((await report(secret())).status, 401);
  assert.equal((await report(receiverToken, 'secondary')).status, 401);
  assert.equal((await report(receiverToken, 'primary', { video:true, audio:true }, 'other-station')).status, 401);
  assert.equal((await report(secondaryToken, 'secondary')).status, 409);
  assert.equal((await fetch(program, { headers: { Authorization: 'Bearer ' + receiverToken } })).status, 401);
  assert.equal((await fetch(program, {
    method: 'POST', headers: { Authorization: 'Bearer ' + receiverToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'stop' }),
  })).status, 401);
  assert.equal((await report(receiverToken, 'primary', { video:true, audio:'yes' })).status, 400);
  for (const [video, audio, expected] of [[true, false, 'video-only'], [false, true, 'audio-only'], [false, false, 'no-media']]) {
    assert.equal((await report(receiverToken, 'primary', { video, audio })).status, 204);
    await until('Track report displayed as ' + expected, expected, session);
  }
  startProbe();
  await until('Receiver decoded encrypted SRT video and audio', 'decoding', session);
  await stopProbe();
  await until('Receiver reports expired after disconnect', 'offline', session);
  startProbe();
  await until('Receiver resumed decoding in the same Program session', 'decoding', session);
  await stopProbe();
  await programAction(station.id, 'stop');
  const restarted = await programAction(station.id, 'start');
  assert.notEqual(restarted.session, session);
  await until('New Program session clears previous receiver health', 'waiting', restarted.session);
} finally {
  await stopProbe();
  await programAction(station.id, 'stop');
  await new Promise(resolve => proxy.close(resolve));
  await new Promise(resolve => server.close(resolve));
}
