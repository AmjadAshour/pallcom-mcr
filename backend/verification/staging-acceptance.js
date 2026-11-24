// Local acceptance only. Requires the disposable McrFixture portable OBS profile in the staging runbook.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  renameSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  openSync,
  readSync,
  closeSync,
  statSync,
  realpathSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, isAbsolute } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import sharp from 'sharp';

const dir = mkdtempSync(join(tmpdir(), 'mcr-phase7-'));
console.log('Evidence directory', dir);
const portable = realpathSync(process.env.MCR_TEST_OBS_DIR);
const rel = relative(realpathSync(tmpdir()), portable);
assert(
  rel && !rel.startsWith('..') && !isAbsolute(rel) && rel.startsWith('pallcom-obs-'),
  'Use the isolated temp OBS fixture'
);
const ini = readFileSync(join(portable, 'config/obs-studio/basic/profiles/McrFixture/basic.ini'), 'utf8');
assert(
  /^FFURL=udp:\/\/127\.0\.0\.1:25100\?pkt_size=1316\s*$/m.test(ini) && /^FFOutputToFile=false\s*$/m.test(ini)
);
assert(process.env.MCR_PROGRAM_PYTHON && process.env.MCR_TEST_PLAYWRIGHT && process.env.MCR_TEST_CHROME);
assert(
  !/obs64\.exe/i.test(
    execFileSync('tasklist', ['/FI', 'IMAGENAME eq obs64.exe', '/NH'], { encoding: 'utf8' })
  ),
  'Cold-start verification requires OBS to be closed'
);
const keys = () => randomBytes(32).toString('hex');
Object.assign(process.env, {
  NODE_ENV: 'test',
  STORAGE_MODE: 'sqlite',
  SQLITE_DB_PATH: join(dir, 'fixture.sqlite'),
  MCR_BIND_HOST: '127.0.0.1',
  JWT_SECRET: keys(),
  REFRESH_TOKEN_SECRET: keys(),
  ENCRYPTION_MASTER_KEY: keys(),
  MCR_ADMIN_PASSWORD: '',
  MCR_PROGRAM_INPUT_PORT: '25100',
  MCR_PROGRAM_OUTPUT_PORT: '25402',
  MCR_PROGRAM_SLATE: 'blue'
});
const { RepositoryFactory: repo } = await import('../src/infrastructure/repositories/repository-factory.js');
const { CryptoService } = await import('../src/infrastructure/security/crypto-service.js');
const { createSession } = await import('../src/infrastructure/security/session-service.js');
const { getSqliteDatabase } = await import('../src/infrastructure/database/sqlite.js');
const db = getSqliteDatabase();
const password = keys();
const station = await repo.getStationRepository().create({
  name: 'Phase 7 isolated',
  organizationId: 'fixture',
  encryptedPassword: CryptoService.encryptSecret(password)
});
process.env.MCR_PROGRAM_STATION_ID = station.id;
async function token(role, org) {
  const u = await repo.getUserRepository().create({
    email: role + org + '@fixture.local',
    fullName: role,
    passwordHash: 'unused',
    role,
    organizationId: org
  });
  return CryptoService.signAccessToken({ sub: u.id, sid: createSession(u.id).id });
}
const operator = await token('OPERATOR', 'fixture'),
  viewer = await token('VIEWER', 'fixture'),
  outsider = await token('SUPER_ADMIN', 'other');
const free = createServer();
free.listen(0, '127.0.0.1');
await once(free, 'listening');
const port = free.address().port;
await new Promise((resolve) => free.close(resolve));
const origin = 'http://127.0.0.1:' + port;
const base = origin + '/api/v1/stations/' + station.id;
const results = [],
  samples = [];
const record = (scenario, data = {}) => {
  results.push({ at: new Date().toISOString(), scenario, ...data });
  console.log(scenario, JSON.stringify(data));
};
let service,
  receiver,
  obs,
  browser,
  latest,
  segment = 0;
let obsCount = 0;
async function until(label, test, ms = 24000) {
  const limit = Date.now() + ms;
  while (Date.now() < limit) {
    if (await test()) return;
    await sleep(120);
  }
  throw Error('Timeout: ' + label + ' ' + JSON.stringify(latest));
}
const request = (suffix, method = 'GET', body, auth = operator, type = 'application/json') =>
  fetch(base + suffix, {
    method,
    headers: { ...(auth ? { Authorization: 'Bearer ' + auth } : {}), 'Content-Type': type },
    body: Buffer.isBuffer(body) ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(18000)
  });
async function data(...args) {
  const r = await request(...args);
  assert(r.ok, 'HTTP ' + r.status + ' ' + args[0]);
  return (await r.json()).data;
}
const send = (action) => data('/program', 'POST', { action });
async function startService(extra = {}) {
  const proc = spawn(process.execPath, ['backend/src/index.js'], {
    windowsHide: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      NODE_ENV: 'development',
      PORT: String(port),
      CORS_ORIGIN: origin,
      APP_URL: origin,
      ...extra
    }
  });
  service = proc;
  await until('API startup', async () => {
    assert(proc.exitCode === null);
    return fetch(origin + '/health')
      .then((r) => r.ok)
      .catch(() => false);
  });
}
async function stop(proc) {
  if (proc && proc.exitCode === null && proc.signalCode === null) {
    const closed = once(proc, 'close');
    proc.kill();
    await closed;
  }
}
function contribute() {
  const cwd = join(portable, 'bin', '64bit');
  obsCount++;
  return spawn(
    join(cwd, 'obs64.exe'),
    [
      '--portable',
      '--multi',
      '--disable-shutdown-check',
      '--disable-missing-files-check',
      '--minimize-to-tray',
      '--profile',
      'McrFixture',
      '--collection',
      'McrFixture',
      '--startrecording'
    ],
    { cwd, windowsHide: true, stdio: 'ignore' }
  );
}
function audioMeter(path) {
  let fd;
  try {
    const size = statSync(path).size,
      n = Math.min(1600, size - (size % 2));
    if (!n) return null;
    fd = openSync(path, 'r');
    const b = Buffer.alloc(n);
    readSync(fd, b, 0, n, size - n);
    let sum = 0,
      cross = 0,
      last = 0;
    for (let i = 0; i < n; i += 2) {
      const v = b.readInt16LE(i) / 32768;
      sum += v * v;
      if (last <= 0 && v > 0) cross++;
      last = v;
    }
    return { rms: Math.sqrt(sum / (n / 2)), hz: (cross * 8000) / (n / 2) };
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
function receive() {
  const id = ++segment;
  const pcm = join(dir, 'audio-' + id + '.pcm');
  const proc = spawn(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-analyzeduration',
      '250000',
      '-probesize',
      '65536',
      '-i',
      'udp://127.0.0.1:25402',
      '-map',
      '0:v:0',
      '-map',
      '0:a:0',
      '-c',
      'copy',
      join(dir, 'program-' + id + '.ts'),
      '-map',
      '0:a:0',
      '-ac',
      '1',
      '-ar',
      '8000',
      '-f',
      's16le',
      '-flush_packets',
      '1',
      pcm,
      '-map',
      '0:v:0',
      '-vf',
      'fps=4,scale=160:90',
      '-pix_fmt',
      'rgb24',
      '-f',
      'rawvideo',
      'pipe:1'
    ],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] }
  );
  receiver = proc;
  latest = null;
  let carry = Buffer.alloc(0);
  proc.stdout.on('data', (chunk) => {
    carry = Buffer.concat([carry, chunk]);
    while (carry.length >= 43200) {
      const frame = carry.subarray(0, 43200);
      carry = carry.subarray(43200);
      const pixel = (x, y) => Array.from(frame.subarray((160 * y + x) * 3, (160 * y + x) * 3 + 3));
      latest = {
        time: Date.now(),
        id,
        center: pixel(80, 45),
        mark: pixel(14, 8),
        left: pixel(22, 64),
        right: pixel(122, 65),
        audio: audioMeter(pcm)
      };
      samples.push(latest);
    }
  });
}
async function endReceiver() {
  const proc = receiver;
  receiver = null;
  if (proc && proc.exitCode === null && proc.signalCode === null) {
    const closed = once(proc, 'close');
    proc.stdin.write('q\n');
    const timer = setTimeout(() => proc.kill(), 1800);
    await closed;
    clearTimeout(timer);
  }
}
const green = (p) => p[1] > 180 && p[0] < 60 && p[2] < 60;
const red = (p) => p[0] > 180 && p[1] < 70 && p[2] < 70;
const blue = (p) => p[2] > 180 && p[0] < 70 && p[1] < 70;
async function observed(label, color, tone) {
  const start = Date.now();
  await until(
    label,
    () =>
      latest?.time > start &&
      color(latest.center) &&
      green(latest.mark) &&
      latest.audio &&
      (tone ? latest.audio.rms > 0.005 && Math.abs(latest.audio.hz - 880) < 35 : latest.audio.rms < 0.002)
  );
  record(label, latest);
}
const png = (color) =>
  sharp({ create: { width: 120, height: 60, channels: 3, background: color } })
    .png()
    .toBuffer();
try {
  await startService();
  assert.equal((await request('/program', 'GET', undefined, null)).status, 401);
  assert.equal((await request('/program', 'POST', { action: 'start' }, viewer)).status, 403);
  assert.equal((await request('/program/ads', 'GET', undefined, outsider)).status, 404);
  assert.equal(
    (
      await request(
        '/program/ads/assets?name=bad',
        'POST',
        Buffer.from('invalid image'),
        operator,
        'image/png'
      )
    ).status,
    400
  );
  assert.equal(
    (
      await request(
        '/program/ads/assets?name=bad',
        'POST',
        Buffer.from('invalid media'),
        operator,
        'video/mp4'
      )
    ).status,
    400
  );
  let hits = 0;
  const unavailable = createServer((req, res) => {
    hits++;
    res.writeHead(503).end();
  });
  unavailable.listen(0, '127.0.0.1');
  await once(unavailable, 'listening');
  try {
    const url = 'http://127.0.0.1:' + unavailable.address().port + '/unavailable';
    assert.equal((await request('/program', 'POST', { action: 'start', url })).status, 400);
    await sleep(200);
    assert.equal(hits, 0);
    record('Unsupported URL rejected before fetch', { hits });
  } finally {
    await new Promise((resolve) => unavailable.close(resolve));
  }
  const publicStation = await data('');
  assert(
    publicStation.hasPassword &&
      !JSON.stringify(publicStation).includes(password) &&
      !('encryptedPassword' in publicStation)
  );
  record('Defensive rejection and station credential redaction');
  assert.equal((await request('/scenes')).status, 503);
  assert.equal((await request('/program', 'POST', { action: 'scene' })).status, 400);
  record('OBS-closed scene inventory 503; independent scene action rejected 400');
  const mark = {
    ...(await data('/program/watermark')).settings,
    enabled: true,
    x: 4,
    y: 4,
    size: 13,
    anchor: 'top-left',
    image: 'data:image/png;base64,' + (await png('#00ff00')).toString('base64'),
    revision: 0
  };
  assert.equal((await request('/program/watermark', 'PUT', mark)).status, 200);
  const upload = (name, bytes, type) =>
    data('/program/ads/assets?name=' + name, 'POST', bytes, operator, type);
  const yellow = await upload('yellow', await png('#ffff00'), 'image/png'),
    pink = await upload('pink', await png('#ff00ff'), 'image/png');
  const clip = join(dir, 'ad.mp4');
  execFileSync(
    'ffmpeg',
    ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=160x90:r=25', '-t', '1', '-c:v', 'libx264', clip],
    { windowsHide: true }
  );
  const movie = await upload('video', readFileSync(clip), 'video/mp4');
  const item = { asset: yellow.id, duration: 1500, gap: 450, enter: 240, exit: 240, dx: 2, dy: 0 };
  const a = {
    id: randomUUID(),
    name: 'Left',
    enabled: true,
    x: 8,
    y: 64,
    w: 20,
    h: 18,
    z: 1,
    startLocal: '',
    endLocal: '',
    items: [item, { ...item, asset: movie.id, duration: 1200, gap: 250 }]
  };
  const b = {
    ...a,
    id: randomUUID(),
    name: 'Right',
    x: 70,
    w: 16,
    h: 20,
    z: 2,
    items: [
      { ...item, asset: pink.id, duration: 1800, gap: 300, dx: 0, dy: 2 },
      { ...item, asset: yellow.id, duration: 800 }
    ]
  };
  const plan = await data('/program/ads', 'PUT', { revision: 0, zone: 'Asia/Jerusalem', placements: [a, b] });
  receive();
  const active = await send('start');
  assert.equal(active.obs, 'disconnected');
  await observed('Cold start slate with watermark and silent audio', blue, false);
  await until('both ads visible', () =>
    samples.some((s) => s.left[0] > 160 && s.left[1] > 150 && s.right[0] > 160 && s.right[2] > 160)
  );
  record('Two simultaneous animated playlists decoded');
  const { chromium } = await import(process.env.MCR_TEST_PLAYWRIGHT);
  browser = await chromium.launch({ executablePath: process.env.MCR_TEST_CHROME });
  const ctx = await browser.newContext();
  await ctx.addCookies([{ name: 'mcr_access_token', value: operator, url: origin }]);
  const page = await ctx.newPage();
  await page.goto(origin + '/live');
  await page.getByRole('button', { name: /^Stop Program$|^إيقاف البرنامج$/ }).waitFor();
  await page.reload();
  await page.getByRole('button', { name: /^Stop Program$|^إيقاف البرنامج$/ }).waitFor();
  assert.equal((await data('/program')).session, active.session);
  await observed('Browser refresh retained Program', blue, false);
  obs = contribute();
  await until('first OBS connection', async () => (await data('/program')).obs === 'ready', 45000);
  await send('obs');
  await observed('Actual OBS red picture and 880 Hz contribution', red, true);
  await stop(obs);
  obs = null;
  await observed('Actual OBS loss to blue slate and silence', blue, false);
  obs = contribute();
  await until('OBS reconnection', async () => (await data('/program')).obs === 'ready', 45000);
  await observed('Reconnected OBS held off air', blue, false);
  await send('obs');
  await observed('Explicit retake recovered picture and tone', red, true);
  assert.equal((await data('/program')).session, active.session);
  await endReceiver();
  await sleep(1000);
  assert.equal((await data('/program')).state, 'running');
  receive();
  await observed('Absent UDP receiver rejoined existing Program', red, true);
  assert.equal((await data('/program')).session, active.session);
  await send('fallback');
  await stop(obs);
  obs = null;
  await observed('Controlled manual fallback before service restart', blue, false);
  // Hide only the known synthetic file in the preflight-checked portable fixture.
  const sourceFile = realpathSync(join(portable, 'fixture.mp4'));
  assert.equal(relative(portable, sourceFile), 'fixture.mp4');
  const heldFile = join(portable, 'fixture-' + randomUUID() + '.mp4');
  renameSync(sourceFile, heldFile);
  try {
    obs = contribute();
    await until(
      'OBS sends media with unavailable fixture file',
      async () => (await data('/program')).obs === 'ready',
      45000
    );
    await send('obs');
    await observed(
      'Missing OBS media file produces black picture and silence',
      (p) => p.every((v) => v < 25),
      false
    );
    await send('fallback');
    await observed('Manual slate recovered missing OBS media', blue, false);
  } finally {
    await stop(obs);
    obs = null;
    renameSync(heldFile, sourceFile);
  }
  // Fault injection affects only a generated creative in this run's disposable database.
  const removed = db.prepare('DELETE FROM ad_frames WHERE stationId=? AND asset=?').run(station.id, pink.id);
  assert.equal(removed.changes, 1);
  await endReceiver();
  await stop(service);
  service = null;
  await startService({ MCR_PROGRAM_OUTPUT_PORT: '25100' });
  assert.equal((await request('/program', 'POST', { action: 'start' })).status, 503);
  assert.equal((await data('/program')).state, 'stopped');
  record('Invalid output configuration rejected before launch');
  await stop(service);
  service = null;
  await startService();
  assert.equal((await data('/program')).state, 'stopped');
  assert.deepEqual(await data('/program/ads').then((v) => v.plan), plan);
  assert.equal((await data('/program/watermark')).revision, 1);
  receive();
  const resumed = await send('start');
  assert.notEqual(resumed.session, active.session);
  await observed('API process restart restored marked Program on explicit start', blue, false);
  const from = Date.now();
  await sleep(4200);
  const restored = samples.filter((s) => s.time >= from);
  assert(
    restored.length >= 10 &&
      restored.every((s) => green(s.mark)) &&
      restored.some((s) => blue(s.right)) &&
      restored.some((s) => s.right[0] > 150 && s.right[1] > 150) &&
      !restored.some((s) => s.right[0] > 150 && s.right[2] > 150)
  );
  record('Missing stored pink creative transparent; next yellow item aired', { samples: restored.length });
  await send('stop');
  record('Final Program stop');
} finally {
  await browser?.close();
  await stop(obs);
  await endReceiver();
  if (service) {
    await request('/program', 'POST', { action: 'stop' }).catch(() => {});
    await stop(service);
  }
  writeFileSync(
    join(dir, 'observations.json'),
    JSON.stringify({ results, samples, obsLaunches: obsCount }, null, 2)
  );
}
