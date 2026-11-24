/** Local staging acceptance, including measured timing in a separately decoded transport stream. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import sharp from 'sharp';
const dir = mkdtempSync(join(tmpdir(), 'mcr-ads-'));
Object.assign(process.env, {
  NODE_ENV: 'test',
  STORAGE_MODE: 'sqlite',
  SQLITE_DB_PATH: join(dir, 'fixture.sqlite'),
  MCR_PROGRAM_INPUT_PORT: '25300',
  MCR_PROGRAM_OUTPUT_PORT: '25302',
  MCR_PROGRAM_SLATE: 'blue'
});
const { server } = await import('../src/index.js');
const { RepositoryFactory: repo } = await import('../src/infrastructure/repositories/repository-factory.js');
const { CryptoService } = await import('../src/infrastructure/security/crypto-service.js');
const { createSession } = await import('../src/infrastructure/security/session-service.js');
const ffmpeg = (args, opts = {}) =>
  promisify(execFile)('ffmpeg', ['-nostdin', '-loglevel', 'error', ...args], {
    windowsHide: true,
    timeout: 35000,
    cwd: dir,
    ...opts
  });
const station = await repo
  .getStationRepository()
  .create({ name: 'Ad fixture', organizationId: 'fixture', encryptedPassword: 'unused' });
process.env.MCR_PROGRAM_STATION_ID = station.id;
async function token(role, org) {
  const u = await repo
    .getUserRepository()
    .create({
      email: role + org + '@fixture.local',
      fullName: role,
      passwordHash: 'unused',
      role,
      organizationId: org
    });
  return CryptoService.signAccessToken({ sub: u.id, sid: createSession(u.id).id });
}
const operator = await token('OPERATOR', 'fixture');
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const root = 'http://127.0.0.1:' + server.address().port + '/api/v1/stations/' + station.id + '/program';
const request = (suffix, method = 'GET', body, auth = operator, mime = 'application/json') =>
  fetch(root + suffix, {
    method,
    headers: { Authorization: 'Bearer ' + auth, 'Content-Type': mime },
    body: Buffer.isBuffer(body) ? body : JSON.stringify(body)
  });
async function call(...args) {
  const res = await request(...args);
  assert(res.ok, await res.clone().text());
  return (await res.json()).data;
}
const solid = (color) =>
  sharp({ create: { width: 200, height: 120, channels: 3, background: color } })
    .png()
    .toBuffer();
const upload = (name, body, mime) => call('/ads/assets?name=' + name, 'POST', body, operator, mime);
const send = (action) => call('', 'POST', { action });
let capture, browser;
try {
  assert.equal((await request('/ads', 'GET', undefined, await token('VIEWER', 'fixture'))).status, 403);
  assert.equal((await request('/ads', 'GET', undefined, await token('SUPER_ADMIN', 'outside'))).status, 404);
  const image = await upload('green', await solid('#00ff00'), 'image/png');
  const upper = await upload('magenta', await solid('#ff00ff'), 'image/png');
  await ffmpeg([
    '-f',
    'lavfi',
    '-i',
    'color=red:s=160x90:r=25:d=0.32',
    '-f',
    'lavfi',
    '-i',
    'color=yellow:s=160x90:r=25:d=0.32',
    '-filter_complex',
    '[0:v][1:v]concat=n=2:v=1:a=0',
    '-c:v',
    'libx264',
    'fixture.mp4'
  ]);
  const video = await upload('two-colors', readFileSync(join(dir, 'fixture.mp4')), 'video/mp4');
  assert(video.frames >= 7 && video.frames <= 9);
  let revision = 0;
  if (process.env.MCR_TEST_PLAYWRIGHT) {
    const { chromium } = await import(process.env.MCR_TEST_PLAYWRIGHT);
    browser = await chromium.launch({ executablePath: process.env.MCR_TEST_CHROME });
    const context = await browser.newContext();
    const origin = new URL(root).origin;
    await context.addCookies([{ name: 'mcr_access_token', value: operator, url: origin }]);
    const page = await context.newPage();
    await page.goto(origin + '/live');
    await page
      .locator('summary')
      .filter({ hasText: /Ad placements|مواضع الإعلانات/ })
      .click();
    const click = (name) => page.getByRole('button', { name }).click({ timeout: 10000 });
    await click(/Add placement|إضافة موضع/);
    await click(/Append selected creative|إضافة الإعلان المحدد للقائمة/);
    await click(/Add placement|إضافة موضع/);
    await page.getByText(/Overlapping boxes|المواضع المتداخلة/).waitFor();
    assert.equal((await call('/ads')).plan.revision, 0);
    await click(/Apply ads to Program|تطبيق الإعلانات على البرنامج/);
    await page.getByRole('heading', { name: /Program controls|تحكم البرنامج/ }).waitFor();
    const saved = (await call('/ads')).plan;
    assert.equal(saved.placements.length, 2);
    assert.equal(saved.placements[0].items[0].asset, image.id);
    revision = saved.revision;
    await browser.close();
    browser = null;
  }
  const item = { asset: image.id, duration: 1600, gap: 600, enter: 400, exit: 400, dx: 10, dy: 0 };
  const base = {
    id: randomUUID(),
    name: 'Rotating',
    x: 10,
    y: 10,
    w: 20,
    h: 20,
    z: 1,
    enabled: true,
    startLocal: '',
    endLocal: '',
    items: [item, { ...item, asset: video.id, duration: 1000, gap: 400, enter: 0, exit: 0, dx: 0 }]
  };
  const top = {
    ...base,
    id: randomUUID(),
    name: 'Top',
    x: 25,
    y: 20,
    w: 10,
    h: 10,
    z: 2,
    items: [{ ...item, asset: upper.id, duration: 5000, gap: 0, enter: 0, exit: 0, dx: 0 }]
  };
  await send('start');
  const movie = join(dir, 'ads.ts');
  capture = ffmpeg([
    '-analyzeduration',
    '200000',
    '-probesize',
    '65536',
    '-i',
    'udp://127.0.0.1:25302',
    '-t',
    '14',
    '-map',
    '0:v',
    '-map',
    '0:a',
    '-c',
    'copy',
    movie
  ]);
  capture.catch(() => {});
  await sleep(1800);
  const plan = await call('/ads', 'PUT', { revision, zone: 'UTC', placements: [base, top] });
  assert.equal(plan.revision, revision + 1);
  assert.equal((await request('/ads/assets/' + image.id, 'DELETE')).status, 409);
  await capture;
  const probe = await promisify(execFile)('ffprobe', [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=width,height,avg_frame_rate',
    '-of',
    'json',
    movie
  ]);
  const { width, height, avg_frame_rate } = JSON.parse(probe.stdout).streams[0];
  assert.deepEqual([width, height, avg_frame_rate], [1280, 720, '25/1']);
  const { stdout } = await ffmpeg(
    ['-i', movie, '-an', '-vf', 'scale=320:180', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1'],
    { encoding: 'buffer', maxBuffer: 85 * 1024 * 1024 }
  );
  const frames = [];
  for (let i = 0; i + 320 * 180 * 3 <= stdout.length; i += 320 * 180 * 3)
    frames.push(stdout.subarray(i, i + 320 * 180 * 3));
  const pixel = (f, x, y) => [...f.subarray((y * 320 + x) * 3, (y * 320 + x) * 3 + 3)];
  const blue = ([r, g, b]) => b > 200 && r < 45 && g < 45;
  const green = ([r, g, b]) => g > 200 && b < 45 && r < 45;
  const magenta = ([r, g, b]) => r > 200 && b > 200 && g < 45;
  const category = (f) => {
    const [r, g, b] = pixel(f, 70, 26);
    if (r > 180 && g > 180 && b < 80) return 'yellow';
    if (r > 180 && g < 80 && b < 80) return 'red';
    if (g > 20 && r < 55) return 'image';
    return 'gap';
  };
  const starts = frames
    .map((f, i) => (i && category(f) === 'image' && category(frames[i - 1]) === 'gap' ? i : -1))
    .filter((i) => i >= 0);
  assert(starts.length >= 3, 'Insufficient decoded cycles: ' + starts);
  const cycle = starts[2] - starts[1];
  assert(Math.abs(cycle - 90) <= 2, 'Cycle length in frames: ' + cycle);
  const start = starts[1];
  const clip = frames.slice(start, start + cycle);
  const videoColors = clip.map(category);
  const videoStart = videoColors.indexOf('red');
  const lastImage = videoColors.lastIndexOf('image');
  const videoEnd = videoColors.findLastIndex((c) => c === 'red' || c === 'yellow');
  assert(Math.abs(videoStart - 55) <= 3, 'Video start frame ' + videoStart);
  assert(Math.abs(videoStart - lastImage - 1 - 15) <= 4, 'Image gap');
  assert(Math.abs(videoEnd - videoStart + 1 - 25) <= 3, 'Video duration');
  assert(Math.abs(cycle - videoEnd - 1 - 10) <= 3, 'Video gap');
  assert(
    videoColors
      .slice(videoStart, videoEnd + 1)
      .join()
      .match(/red.*yellow.*red/),
    'Short video must loop'
  );
  assert(
    clip.every((f) => magenta(pixel(f, 90, 44))),
    'Higher layer lost at overlap'
  );
  const mid = clip[19];
  assert(green(pixel(mid, 65, 20)) && green(pixel(mid, 90, 52)) === false);
  const xs = Array.from({ length: 320 }, (_, x) => x).filter((x) => green(pixel(mid, x, 26)));
  const ys = Array.from({ length: 180 }, (_, y) => y).filter((y) => green(pixel(mid, 65, y)));
  assert(Math.abs(xs.length - 64) <= 3 && Math.abs(ys.length - 36) <= 3, 'Incorrect 20% x 20% size');
  assert(Math.abs(xs[0] - 48) <= 3 && Math.abs(ys[0] - 18) <= 2, 'Incorrect moving placement');
  const topXs = Array.from({length:320},(_,x)=>x).filter(x=>magenta(pixel(mid,x,44)));
  const topYs = Array.from({length:180},(_,y)=>y).filter(y=>magenta(pixel(mid,90,y)));
  assert(Math.abs(topXs[0]-80)<=2 && Math.abs(topYs[0]-36)<=2 && Math.abs(topXs.length-32)<=2 && Math.abs(topYs.length-18)<=2,
    'Upper placement offset or size');
  const greens = clip.map((f) => pixel(f, 70, 26)[1]);
  assert(greens[2] < greens[7] && greens[7] < greens[15] && greens[30] > greens[36], 'Fade envelope');
  const early = clip[10],
    late = clip[27];
  assert(green(pixel(early, 44, 26)) && !green(pixel(late, 44, 26)), 'Horizontal movement');
  await sharp(mid, { raw: { width: 320, height: 180, channels: 3 } })
    .png()
    .toFile(join(dir, 'overlap.png'));
  for (const [index, action] of ['pause', 'skip', 'resume', 'disable'].entries()) {
    const next = await call('/ads/control', 'POST', { id: base.id, revision: plan.revision + index, action });
    assert.equal(next.revision, plan.revision + 1 + index);
  }
  await send('stop');
  await send('start');
  const restored = (await call('/ads')).plan;
  assert(!restored.placements[0].enabled && restored.placements[1].enabled);
  console.log(
    JSON.stringify(
      {
        directory: dir,
        frames: frames.length,
        cycleFrames: cycle,
        videoStart,
        videoFrames: videoEnd - videoStart + 1,
        imageGapFrames: videoStart - lastImage - 1,
        videoGapFrames: cycle - videoEnd - 1,
        boxAtMidpoint: [xs[0], ys[0], xs.length, ys.length]
      },
      null,
      2
    )
  );
} finally {
  await browser?.close();
  await send('stop');
  server.closeAllConnections();
  server.close();
}
