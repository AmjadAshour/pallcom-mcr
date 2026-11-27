/** Compare the authenticated Program audio monitor with a separate UDP receiver. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const secret = () => randomBytes(32).toString('hex');
Object.assign(process.env, {
  NODE_ENV: 'test', STORAGE_MODE: 'sqlite',
  SQLITE_DB_PATH: join(mkdtempSync(join(tmpdir(), 'mcr-audio-monitor-')), 'fixture.sqlite'),
  JWT_SECRET: secret(), REFRESH_TOKEN_SECRET: secret(), ENCRYPTION_MASTER_KEY: secret(),
  MCR_PROGRAM_INPUT_PORT: '25520', MCR_PROGRAM_OUTPUT_PORT: '25522', MCR_PROGRAM_INPUT_HOST: '127.0.0.1',
  MCR_PROGRAM_INPUT_URL: '', MCR_PROGRAM_SECOND_INPUT_PORT: '', MCR_PROGRAM_RUNTIME_PORT: '',
  MCR_PROGRAM_RECORDING_DIR: '', MCR_PROGRAM_AUTO_BACKUP: '0', MCR_PROGRAM_AUDIO_MONITOR: '1',
  MCR_PROGRAM_SRT_URL: '', MCR_PROGRAM_SRT_PASSPHRASE: '',
  MCR_PROGRAM_SECOND_SRT_URL: '', MCR_PROGRAM_SECOND_SRT_PASSPHRASE: '',
});
const { server } = await import('../src/index.js');
const { RepositoryFactory: repo } = await import('../src/infrastructure/repositories/repository-factory.js');
const { CryptoService } = await import('../src/infrastructure/security/crypto-service.js');
const { createSession, revokeSession } = await import('../src/infrastructure/security/session-service.js');
const { getSqliteDatabase } = await import('../src/infrastructure/database/sqlite.js');
const { default: jwt } = await import('jsonwebtoken');
const station = await repo.getStationRepository().create({
  name: 'Audio monitor fixture', organizationId: 'fixture', encryptedPassword: 'unused',
});
process.env.MCR_PROGRAM_STATION_ID = station.id;
async function member(role, organizationId) {
  const user = await repo.getUserRepository().create({
    email: role + organizationId + '@fixture.local', fullName: role, passwordHash: 'unused', role, organizationId,
  });
  const { id: sessionId } = createSession(user.id);
  return { token: CryptoService.signAccessToken({ sub:user.id, sid:sessionId }), sessionId, userId:user.id };
}
const operator = await member('OPERATOR', 'fixture');
const viewer = await member('VIEWER', 'fixture');
const other = await member('OPERATOR', 'other');
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const origin = 'http://127.0.0.1:' + server.address().port;
const url = origin + '/api/v1/stations/' + station.id + '/program';
const monitor = url + '/audio-monitor';
const headers = token => ({ Authorization:'Bearer ' + token, 'Content-Type':'application/json' });
async function status() {
  return (await (await fetch(url, { headers:headers(operator.token) })).json()).data;
}
async function action(action, parameters = {}) {
  const response = await fetch(url, {
    method:'POST', headers:headers(operator.token), body:JSON.stringify({ action, ...parameters }),
  });
  const result = await response.json();
  assert.equal(response.status, 200, result.error);
  return result.data;
}
const devices = [];
function ffmpeg(args, stdio) {
  const proc = spawn('ffmpeg', ['-nostdin', '-loglevel', 'error', ...args], { windowsHide:true, stdio });
  devices.push(proc);
  return proc;
}
function receive(input, options = []) {
  const child = ffmpeg([...options, '-analyzeduration','500000','-probesize','8192','-i',input,
    '-map','0:a','-ac','1','-ar','8000','-f','s16le','pipe:1'], ['ignore','pipe','ignore']);
  const feed = { level:0, bytes:0, energy:0, child };
  let carry = Buffer.alloc(0);
  child.stdout.on('data', chunk => {
    const pcm = carry.length ? Buffer.concat([carry, chunk]) : chunk;
    const count = Math.floor(pcm.length / 2);
    let sum = 0;
    for (let i = 0; i < count; i++) sum += pcm.readInt16LE(i * 2) ** 2;
    if (count) feed.level = Math.sqrt(sum / count);
    feed.energy += sum;
    feed.bytes += count * 2;
    carry = pcm.subarray(count * 2);
  });
  return feed;
}
async function until(label, check) {
  const deadline = Date.now() + 16000;
  while (!await check()) {
    assert(Date.now() < deadline, label + ' timed out');
    await sleep(100);
  }
  console.log(label);
}
async function measureRms(...feeds) {
  const start = feeds.map(({ bytes, energy }) => ({ bytes, energy }));
  const deadline = Date.now() + 5000;
  while (!feeds.every((feed, index) => feed.bytes - start[index].bytes >= 16000)) {
    assert(Date.now() < deadline, 'One-second PCM measurement timed out');
    await sleep(100);
  }
  return feeds.map((feed, index) =>
    Math.sqrt(2 * (feed.energy - start[index].energy) / (feed.bytes - start[index].bytes)));
}
let browser;
try {
  assert.equal((await fetch(monitor)).status, 401);
  assert.equal((await fetch(monitor, { headers:headers(other.token) })).status, 404);
  assert.equal((await fetch(monitor, { headers:headers(viewer.token) })).status, 503);
  const udp = receive('udp://127.0.0.1:25522');
  const { session, audioMonitorAvailable } = await action('start');
  assert.equal(audioMonitorAvailable, true, 'GStreamer MP3 encoder unavailable');
  const mp3 = receive(monitor, ['-headers','Authorization: Bearer ' + viewer.token + '\r\n']);
  await until('Authenticated monitor and UDP receive the silent slate', () => udp.bytes > 16000 && mp3.bytes > 16000 &&
    udp.level < 10 && mp3.level < 10);
  ffmpeg(['-re','-f','lavfi','-i','color=red:s=320x180:r=25','-f','lavfi','-i','sine=frequency=880:sample_rate=48000',
    '-c:v','libx264','-tune','zerolatency','-g','25','-c:a','aac','-f','mpegts','udp://127.0.0.1:25520?pkt_size=1316'], 'ignore');
  await until('Test input is ready', async () => (await status()).obs === 'ready');
  await action('obs');
  await until('Monitor MP3 and UDP AAC both decode the on-air tone', () => udp.level > 500 && mp3.level > 500);

  if (process.env.MCR_TEST_PLAYWRIGHT) {
    const { chromium } = await import(process.env.MCR_TEST_PLAYWRIGHT);
    browser = await chromium.launch({ executablePath:process.env.MCR_TEST_CHROME });
    const context = await browser.newContext();
    await context.addCookies([{ name:'mcr_access_token', value:viewer.token, url:origin }]);
    const page = await context.newPage();
    await page.goto(origin + '/live');
    const listen = page.getByRole('button', { name:/Listen to Program|الاستماع إلى Program/ });
    assert.equal(await page.locator('audio[src]').count(), 0);
    await listen.click();
    await page.waitForFunction(() => document.querySelector('audio')?.currentTime >= 0.25);
    assert.equal(await page.locator('audio').evaluate(player => player.paused), false);
    await page.getByRole('button', { name:/Stop listening|إيقاف الاستماع/ }).click();
    await listen.waitFor();
    assert.equal(await page.locator('audio[src]').count(), 0);
    await browser.close();
    browser = undefined;
    console.log('Chrome starts and releases authenticated Program audio on demand');
  }

  await action('mute');
  await until('Both receivers decode silence after Program mute', () => udp.level < 10 && mp3.level < 10);
  await action('unmute');
  await until('Both receivers decode sound after restoration', () => udp.level > 500 && mp3.level > 500);
  const [beforeUdp, beforeMp3] = await measureRms(udp, mp3);
  await action('gain', { gainDb:-12 });
  const attenuated = (level, baseline) => level / baseline > 0.20 && level / baseline < 0.32;
  await until('Both receivers measure the applied Program attenuation', async () => {
    const [afterUdp, afterMp3] = await measureRms(udp, mp3);
    return attenuated(afterUdp, beforeUdp) && attenuated(afterMp3, beforeMp3);
  });
  await action('gain', { gainDb:0 });
  await until('Both receivers recover from attenuation', () => udp.level > 500 && mp3.level > 500);
  revokeSession(viewer.sessionId, viewer.userId);
  await until('Revoked session closes the MP3 stream while UDP continues', () =>
    mp3.child.exitCode !== null && udp.level > 500);
  assert.equal((await status()).session, session);
  async function checkMonitorClosure(label, memberToken, invalidate, expectedStatus) {
    const response = await fetch(monitor, { headers:headers(memberToken), signal:AbortSignal.timeout(8000) });
    assert.equal(response.status, 200, label);
    const reader = response.body.getReader();
    assert.equal((await reader.read()).done, false, label);
    const bytes = udp.bytes;
    invalidate();
    while (!(await reader.read()).done) {
      // Consume buffered MP3 until the server closes the connection.
    }
    assert.equal((await fetch(monitor, { headers:headers(memberToken) })).status, expectedStatus, label);
    assert.equal((await status()).session, session, label);
    assert(udp.bytes > bytes, label);
    console.log(label);
  }
  const shortLivedToken = jwt.sign({ sub:operator.userId, sid:operator.sessionId },
    process.env.JWT_SECRET, { expiresIn:3, issuer:'MCR_PRO', audience:'mcr_client' });
  await checkMonitorClosure('Access token expiry closes MP3 and rejects reconnection', shortLivedToken, () => {}, 401);
  assert.equal((await fetch(monitor, { headers:headers(viewer.token) })).status, 401);
  const db = getSqliteDatabase();
  const expires = await member('STUDIO_MANAGER', 'fixture');
  await checkMonitorClosure('Session expiry closes MP3', expires.token,
    () => db.prepare('UPDATE auth_sessions SET expiresAt=0 WHERE id=?').run(expires.sessionId), 401);
  const changesRole = await member('ORG_ADMIN', 'fixture');
  await checkMonitorClosure('Loss of station-read permission closes MP3', changesRole.token,
    () => db.prepare("UPDATE users SET role='UNKNOWN' WHERE id=?").run(changesRole.userId), 403);
  const movesOrganization = await member('SUPER_ADMIN', 'fixture');
  await checkMonitorClosure('Organization change closes MP3', movesOrganization.token,
    () => db.prepare("UPDATE users SET organizationId='other' WHERE id=?").run(movesOrganization.userId), 404);
  const connection = await fetch(monitor, { headers:headers(operator.token) });
  assert.equal(connection.headers.get('content-type'), 'audio/mpeg');
  assert.match(connection.headers.get('cache-control'), /no-store/);
  await action('stop');
  await connection.arrayBuffer();
  console.log('Stopping Program ends active monitor connections');
  process.env.MCR_PROGRAM_AUDIO_MONITOR = '0';
  assert.equal((await action('start')).audioMonitorAvailable, false);
  assert.equal((await fetch(monitor, { headers:headers(operator.token) })).status, 503);
  console.log('Program starts with audio monitoring disabled');
} finally {
  await browser?.close();
  for (const device of devices) device.kill();
  await action('stop');
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
