import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, readdirSync, rmdirSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import express from 'express';
import { inspectTransport } from '../scripts/inspect-program-ts.js';

const directory = mkdtempSync(join(tmpdir(), 'mcr-hls-fixture-'));
const secret = () => randomBytes(32).toString('hex');
Object.assign(process.env, {
  NODE_ENV:'test', STORAGE_MODE:'sqlite', SQLITE_DB_PATH:join(directory, 'test.sqlite'),
  JWT_SECRET:secret(), REFRESH_TOKEN_SECRET:secret(), ENCRYPTION_MASTER_KEY:secret(),
  MCR_PROGRAM_RUNTIME_PORT:'', MCR_PROGRAM_INPUT_HOST:'127.0.0.1', MCR_PROGRAM_SLATE:'blue',
  MCR_PROGRAM_INPUT_PORT:'25530', MCR_PROGRAM_OUTPUT_PORT:'25532', MCR_PROGRAM_INPUT_URL:'',
  MCR_PROGRAM_SECOND_INPUT_PORT:'', MCR_PROGRAM_AUTO_BACKUP:'0', MCR_PROGRAM_RECORDING_DIR:'',
  MCR_PROGRAM_SRT_URL:'', MCR_PROGRAM_SRT_PASSPHRASE:'',
  MCR_PROGRAM_SECOND_SRT_URL:'', MCR_PROGRAM_SECOND_SRT_PASSPHRASE:'', MCR_PROGRAM_HLS_DIR:directory,
});
const { server } = await import('../src/index.js');
const { getSqliteDatabase } = await import('../src/infrastructure/database/sqlite.js');
const { RepositoryFactory: repo } = await import('../src/infrastructure/repositories/repository-factory.js');
const { CryptoService } = await import('../src/infrastructure/security/crypto-service.js');
const { createSession, revokeSession } = await import('../src/infrastructure/security/session-service.js');
const { forwardProgram } = await import('../src/infrastructure/program/runtime-proxy.js');
const station = await repo.getStationRepository().create({ name:'HLS fixture', organizationId:'isolated', encryptedPassword:'unused' });
const siblingStation = await repo.getStationRepository().create({
  name:'Other station in the same organization', organizationId:station.organizationId, encryptedPassword:'unused'
});
process.env.MCR_PROGRAM_STATION_ID = station.id;
async function token(role, organizationId) {
  const user = await repo.getUserRepository().create({
    email:role + organizationId + '@fixture.local', fullName:role, passwordHash:'unused', role, organizationId
  });
  return CryptoService.signAccessToken({ sub:user.id, sid:createSession(user.id).id });
}
const operator = await token('OPERATOR', 'isolated');
const viewer = await token('VIEWER', 'isolated');
const outsider = await token('VIEWER', 'elsewhere');
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const web = express();
web.use(forwardProgram(server.address().port));
const proxy = web.listen(0, '127.0.0.1');
await once(proxy, 'listening');
const root = 'http://127.0.0.1:' + proxy.address().port + '/api/v1/stations/' + station.id + '/program';
const headers = access => ({ Authorization:'Bearer ' + access, 'Content-Type':'application/json' });
async function program(action) {
  const response = await fetch(root, {
    method:action ? 'POST' : 'GET', headers:headers(operator), body:action && JSON.stringify({action}),
  });
  const payload = await response.json();
  assert.equal(response.status, 200, payload.error);
  return payload.data;
}
function receiver(url, auth) {
  const child = spawn('ffmpeg', ['-nostdin','-loglevel','error', ...(auth ?
    ['-headers','Authorization: Bearer ' + auth + '\r\n','-live_start_index','-1'] : []),
  '-analyzeduration','400000','-probesize','32768','-i',url,'-map','0:v','-vf','scale=1:1','-pix_fmt','rgb24',
  '-f','rawvideo','pipe:1','-map','0:a','-f','s16le','pipe:3'],
  { windowsHide:true, stdio:['ignore','pipe','pipe','pipe'] });
  const sample = { child, videoBytes:0, audioBytes:0, blue:false, error:'' };
  child.once('exit', (code, signal) => {
    if (child.killed || code === 0) return;
    console.error(auth || url.startsWith('http') ? 'HLS receiver exited' : 'UDP receiver exited', { code, signal });
  });
  let remainder = Buffer.alloc(0);
  child.stdout.on('data', bytes => {
    sample.videoBytes += bytes.length;
    const pixels = Buffer.concat([remainder, bytes]);
    const end = pixels.length - pixels.length % 3;
    for (let index = 0; index < end; index += 3) {
      if (pixels[index] < 40 && pixels[index + 1] < 40 && pixels[index + 2] > 180) sample.blue = true;
    }
    remainder = pixels.subarray(end);
  });
  child.stdio[3].on('data', bytes => { sample.audioBytes += bytes.length; });
  child.stderr.setEncoding('utf8').on('data', chunk => { sample.error = (sample.error + chunk).slice(-2048); });
  return sample;
}
async function until(label, pass) {
  const deadline = Date.now() + 22000;
  while (!await pass()) {
    if (Date.now() > deadline) throw Error(label + ': ' + JSON.stringify(await program()) + ' ' + (hls?.error ?? ''));
    await sleep(160);
  }
  console.log(label);
}
const udp = receiver('udp://127.0.0.1:25532');
let hls;
async function closeReceiver(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const closed = once(child, 'close');
  child.kill();
  await closed;
}
function assertPrivacy(response) {
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
}
let verified = false;
let stopped = false;
let fixtureError;
try {
  process.env.MCR_PROGRAM_INPUT_HOST = '192.0.2.1';
  process.env.MCR_PROGRAM_TRUST_PRIVATE_UDP = '0';
  const untrustedUdp = await fetch(root, {
    method:'POST', headers:headers(operator), body:JSON.stringify({ action:'start' }),
  });
  assert.equal(untrustedUdp.status, 503);
  assert.equal((await untrustedUdp.json()).error, 'Service unavailable');
  process.env.MCR_PROGRAM_INPUT_HOST = '127.0.0.1';
  const { session } = await program('start');
  const playlist = root + '/hls/' + session + '/index.m3u8';
  await until('Authenticated HLS playlist becomes ready', async () => (await program()).hls === 'ready');
  const unauthenticated = await fetch(playlist);
  assert.equal(unauthenticated.status, 401);
  assertPrivacy(unauthenticated);
  assert.equal((await fetch(playlist, { headers:headers(outsider) })).status, 404);
  const response = await fetch(playlist, { headers:headers(viewer) });
  assert.match(response.headers.get('content-type'), /application\/vnd\.apple\.mpegurl/);
  assertPrivacy(response);
  const manifest = await response.text();
  assert.match(manifest, /^#EXTM3U/);
  const segment = manifest.match(/^segment\d{5,10}\.ts\r?$/m)?.[0].trim();
  assert(segment, manifest);
  assert.equal((await fetch(new URL(segment, playlist))).status, 401);
  const range = await fetch(new URL(segment, playlist), { headers:{ ...headers(viewer), Range:'bytes=0-187' } });
  assert.equal(range.status, 206);
  assertPrivacy(range);
  assert.equal((await range.arrayBuffer()).byteLength, 188);
  const validSegment = await fetch(new URL(segment, playlist), { headers:headers(viewer) });
  assert.equal(validSegment.status, 200);
  const capture = Buffer.from(await validSegment.arrayBuffer());
  const capturePath = join(directory, 'receiver-segment.ts');
  writeFileSync(capturePath, capture);
  const report = await inspectTransport(capturePath);
  assert(report.hasPat && report.packets > 20 && report.pids.length >= 3);
  assert.equal(report.invalidHeaders + report.continuityErrors + report.transportErrors + report.trailingBytes, 0);
  const damagedPath = join(directory, 'receiver-packet-loss.ts');
  const busiest = report.pids.filter(track => track.pid !== 0x1fff).sort((a,b) => b.packets - a.packets)[0].pid;
  const offsets = [];
  for (let offset = 0; offset < capture.length; offset += 188) {
    const pid = ((capture[offset + 1] & 31) << 8) | capture[offset + 2];
    if (pid === busiest && capture[offset + 3] & 0x10) offsets.push(offset);
  }
  const drop = offsets[Math.floor(offsets.length / 2)];
  assert(offsets.length > 3 && drop > 0);
  writeFileSync(damagedPath, Buffer.concat([capture.subarray(0, drop), capture.subarray(drop + 188)]));
  assert.equal((await inspectTransport(damagedPath)).continuityErrors, 1);
  console.log('Captured Program transport continuity and loss detection passed');
  assert.equal((await fetch(new URL('..%2f..%2ftest.sqlite', playlist), { headers:headers(viewer) })).status, 404);
  const mint = root + '/hls/playback-link';
  assert.equal((await fetch(mint, { method:'POST' })).status, 401);
  assert.equal((await fetch(mint, { method:'POST', headers:headers(viewer) })).status, 403);
  const link = await fetch(mint, { method:'POST', headers:headers(operator) });
  assert.equal(link.status, 200);
  assertPrivacy(link);
  const { data } = await link.json();
  const playback = new URL(data.path, root);
  const ticket = playback.pathname.split('/').at(-2);
  const signedPlaylist = await fetch(playback);
  assert.equal(signedPlaylist.status, 200);
  assertPrivacy(signedPlaylist);
  await signedPlaylist.text();
  assert.equal((await fetch(new URL(segment, playback))).status, 200);
  const otherStation = new URL(playback.href.replace('/stations/' + station.id + '/', '/stations/' + siblingStation.id + '/'));
  const otherSession = new URL(playback.href.replace('/hls/' + session + '/', '/hls/other-session/'));
  for (const invalidScope of [otherStation, otherSession]) {
    for (const path of [invalidScope, new URL(segment, invalidScope)]) {
      const response = await fetch(path);
      assert.equal(response.status, 404);
      assertPrivacy(response);
      await response.arrayBuffer();
    }
  }
  console.log('Signed HLS is scoped to station and session for playlists and segments');
  assert.equal((await fetch(playback.href.replace(ticket, 'invalid-token'))).status, 401);
  assert.equal((await fetch('http://127.0.0.1:' + server.address().port + '/api/v1/auth/me', { headers:headers(ticket) })).status, 401);
  hls = receiver(playback.href);
  await until('HLS and UDP decode Program video and audio independently', () =>
    hls.blue && hls.videoBytes > 45 && hls.audioBytes > 12000 && udp.blue && udp.audioBytes > 12000);
  await until('HLS live window advances', async () => {
    const response = await fetch(playlist, { headers:headers(viewer) });
    return response.ok && /^#EXT-X-MEDIA-SEQUENCE:[1-9]/m.test(await response.text());
  });
  const segmentDirectory = readdirSync(directory).find(name => name.startsWith('program-hls-'));
  assert(segmentDirectory);
  assert(readdirSync(join(directory, segmentDirectory)).filter(name => name.endsWith('.ts')).length <= 7);
  const temporaryOperator = await token('ORG_ADMIN', 'isolated');
  const revokedLink = await fetch(mint, { method:'POST', headers:headers(temporaryOperator) });
  assert.equal(revokedLink.status, 200);
  const { data: revoked } = await revokedLink.json();
  const claims = CryptoService.verifyAccessToken(temporaryOperator);
  revokeSession(claims.sid, claims.sub);
  const denied = await fetch(new URL(revoked.path, root));
  assert.equal(denied.status, 401);
  assertPrivacy(denied);
  await program('stop');
  assert.equal((await fetch(playback)).status, 404);
  assert.equal((await fetch(playlist, { headers:headers(viewer) })).status, 404);
  await until('HLS session files are cleaned after stop', () => !readdirSync(directory).includes(segmentDirectory));
  await closeReceiver(hls.child);
  const blocked = await program('start');
  assert.equal(blocked.hls, 'starting');
  const staging = readdirSync(directory).find(name => name.startsWith('program-hls-'));
  assert(staging);
  const blockedFile = join(directory, staging, 'index.m3u8');
  mkdirSync(blockedFile);
  await until('HLS writer reports its runtime failure while UDP advances', async () => {
    const current = await program();
    assert.equal(current.session, blocked.session);
    return current.hls === 'failed' && current.state === 'running';
  });
  const duringFailure = udp.videoBytes;
  await until('UDP keeps decoding after the HLS writer failure', () => udp.videoBytes > duringFailure + 90);
  rmdirSync(blockedFile);
  await program('stop');
  process.env.MCR_PROGRAM_HLS_DIR = join(directory, 'unavailable');
  const failed = await program('start');
  assert.equal(failed.hls, 'failed');
  assert.equal(failed.state, 'running');
  assert.notEqual(failed.session, session);
  const previous = udp.videoBytes;
  await until('UDP continues with an unavailable HLS destination', () => udp.videoBytes > previous + 90);
  verified = true;
} catch (error) {
  fixtureError = error;
} finally {
  const receivers = Promise.all([closeReceiver(hls?.child), closeReceiver(udp.child)]);
  try {
    await program('stop');
    stopped = true;
  } catch (error) {
    fixtureError ??= error;
  }
  try {
    proxy.closeAllConnections();
    server.closeAllConnections();
    await Promise.all([
      new Promise(resolve => proxy.close(resolve)),
      new Promise(resolve => server.close(resolve)),
      receivers
    ]);
    getSqliteDatabase().close();
    if (verified && stopped) {
      await rm(directory, { recursive:true, force:true, maxRetries:5, retryDelay:100 });
    }
  } catch (error) {
    fixtureError ??= error;
  }
}
if (fixtureError) {
  console.error('HLS fixture failed:', fixtureError.message);
  process.exitCode = 1;
} else {
  console.log('HLS receiver and output isolation passed');
}
