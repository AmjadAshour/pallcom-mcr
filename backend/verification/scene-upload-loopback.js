import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { appendFileSync, mkdtempSync, openAsBlob } from 'node:fs';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const directory = mkdtempSync(join(tmpdir(), 'mcr-scene-upload-'));
const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
const secret = () => randomBytes(32).toString('hex');
Object.assign(process.env, {
  NODE_ENV: 'development', STORAGE_MODE: 'sqlite', SQLITE_DB_PATH: join(directory, 'fixture.sqlite'),
  MCR_BIND_HOST: '127.0.0.1', PORT: '25800', MCR_PROGRAM_RUNTIME_PORT: '25801',
  MCR_PROGRAM_INPUT_HOST: '127.0.0.1', MCR_PROGRAM_INPUT_PORT: '25802', MCR_PROGRAM_OUTPUT_PORT: '25803',
  MCR_PROGRAM_SECOND_INPUT_PORT: '', MCR_PROGRAM_INPUT_URL: '', MCR_PROGRAM_SRT_URL: '',
  MCR_PROGRAM_SRT_PASSPHRASE: '', MCR_PROGRAM_RECORDING_DIR: '', MCR_PROGRAM_AUTOSTART: '0',
  JWT_SECRET: secret(), REFRESH_TOKEN_SECRET: secret(), ENCRYPTION_MASTER_KEY: secret()
});
const { RepositoryFactory } = await import('../src/infrastructure/repositories/repository-factory.js');
const { CryptoService } = await import('../src/infrastructure/security/crypto-service.js');
const { createSession } = await import('../src/infrastructure/security/session-service.js');
const station = await RepositoryFactory.getStationRepository().create({
  name: 'Scene upload fixture', organizationId: 'fixture', encryptedPassword: 'unused'
});
const user = await RepositoryFactory.getUserRepository().create({
  email: 'scene-upload@fixture.local', fullName: 'Operator', passwordHash: 'unused', role: 'OPERATOR', organizationId: 'fixture'
});
process.env.MCR_PROGRAM_STATION_ID = station.id;
const token = CryptoService.signAccessToken({ sub: user.id, sid: createSession(user.id).id });
const root = 'http://127.0.0.1:25800/api/v1/stations/' + station.id + '/program';
const path = '/local-scene';
const clip = process.argv[2] || join(directory, 'fixture.mp4');
if (!process.argv[2]) {
  execFileSync(ffmpeg, ['-nostdin', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=25',
    '-f', 'lavfi', '-i', 'sine=f=440', '-t', '3', '-c:v', 'libx264', '-c:a', 'aac', clip], { windowsHide: true });
  const padding = Buffer.alloc(16 * 1024 ** 2);
  padding.writeUInt32BE(padding.length);
  padding.write('free', 4);
  appendFileSync(clip, padding);
}
const media = await openAsBlob(clip, { type: 'video/mp4' });
assert(media.size > 12 * 1024 ** 2);
const call = (suffix = '', method = 'GET', body, authorized = true) => fetch(root + suffix, { method,
  headers: { ...(authorized && { Authorization: 'Bearer ' + token }),
    ...(body && { 'Content-Type': body instanceof Blob ? 'video/mp4' : 'application/json' }) },
  body: body instanceof Blob ? body : JSON.stringify(body), signal: AbortSignal.timeout(180000)
});
async function result(response, status = 200) {
  const body = await response.json();
  assert.equal(response.status, status, JSON.stringify(body));
  return body.data;
}
async function waitFor(check) {
  const deadline = Date.now() + 20000;
  while (!await check()) {
    if (Date.now() >= deadline) throw new Error('Scene upload fixture timed out');
    await sleep(100);
  }
}
const start = script => spawn(process.execPath, [script], { windowsHide: true, stdio: 'inherit' });
async function stop(child) {
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = once(child, 'close');
    child.kill();
    await exited;
  }
}
const runtime = start('backend/src/program-runtime.js');
const web = start('backend/src/index.js');
let decoder;
try {
  await waitFor(() => call(path + '/library', 'GET', undefined, false).then(r => r.status === 401).catch(() => false));
  const upload = path + '/video?name=Playout%20fixture.mp4';
  const asset = await result(await call(upload, 'POST', media), 201);
  assert.equal(asset.kind, 'video');
  const scene = { id: randomUUID(), name: 'Video only', video: asset.id, x: 5, y: 5, w: 20, h: 20 };
  await result(await call(path, 'PUT', scene));
  const started = await result(await call('', 'POST', { action: 'start' }));
  const preview = await result(await call(path + '/preview', 'POST', scene));
  assert.match(preview, /^data:image\/jpeg;base64,/);
  const taken = await result(await call(path + '/take', 'POST', scene));
  assert.equal(taken.source, 'scene');
  await result(await call('', 'POST', { action: 'fallback' }));
  assert.equal((await call(path + '/video/take', 'POST', { video: asset.id }, false)).status, 401);
  assert.equal((await call(path + '/video/take', 'POST', { video: randomUUID() })).status, 409);
  assert.equal((await result(await call(''))).source, 'fallback');
  const videoInput = await result(await call(path + '/video/take', 'POST', { video: asset.id }));
  assert.equal(videoInput.session, started.session);
  assert.equal(videoInput.source, 'scene');
  assert.equal(videoInput.sceneVideo, asset.id);
  assert.deepEqual(await result(await call(path + '/library')), [scene]);
  decoder = spawn(ffmpeg, ['-nostdin', '-loglevel', 'error', '-i', 'udp://127.0.0.1:25803?timeout=8000000',
    '-t', '2', '-map', '0:v', '-vf', 'scale=64:36', '-f', 'framemd5', 'pipe:1'],
  { windowsHide: true, stdio: ['ignore', 'pipe', 'inherit'] });
  let output = '';
  decoder.stdout.on('data', chunk => { output += chunk.toString(); });
  const [exitCode] = await once(decoder, 'close');
  assert.equal(exitCode, 0);
  const hashes = output.split('\n').flatMap(line => /^0,/.test(line) ? [line.split(',').at(-1).trim()] : []);
  assert(new Set(hashes).size > 4, 'Independent receiver should decode moving video');
  console.log('Large MP4 uploaded and video-only scene decoded');
} finally {
  await call('', 'POST', { action: 'stop' }).catch(() => {});
  await Promise.all([stop(decoder), stop(web), stop(runtime)]);
}
