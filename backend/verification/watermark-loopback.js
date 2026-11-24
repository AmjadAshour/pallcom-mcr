/** Isolated HTTP + media receiver acceptance. Requires the Phase 2 staging runtime. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import sharp from 'sharp';

const directory = mkdtempSync(join(tmpdir(), 'mcr-watermark-'));
Object.assign(process.env, { NODE_ENV: 'test', STORAGE_MODE: 'sqlite', SQLITE_DB_PATH: join(directory, 'fixture.sqlite'),
  MCR_PROGRAM_INPUT_PORT: '25200', MCR_PROGRAM_OUTPUT_PORT: '25202', MCR_PROGRAM_SLATE: 'blue' });
const { server } = await import('../src/index.js');
const { RepositoryFactory: repo } = await import('../src/infrastructure/repositories/repository-factory.js');
const { CryptoService } = await import('../src/infrastructure/security/crypto-service.js');
const { createSession } = await import('../src/infrastructure/security/session-service.js');
async function token(role, organizationId) {
  const user = await repo.getUserRepository().create({ email: role + organizationId + '@fixture.local', fullName: role,
    passwordHash: 'unused', role, organizationId });
  return CryptoService.signAccessToken({ sub: user.id, sid: createSession(user.id).id });
}
const operator = await token('OPERATOR', 'fixture');
const station = await repo.getStationRepository().create({ name: 'Watermark fixture', organizationId: 'fixture',
  encryptedPassword: CryptoService.encryptSecret('fixture') });
process.env.MCR_PROGRAM_STATION_ID = station.id;
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const origin = 'http://127.0.0.1:' + server.address().port;
const root = origin + '/api/v1/stations/' + station.id + '/program';
const request = (suffix, method = 'GET', body, auth = operator) => fetch(root + suffix, {
  method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + auth },
  body: body && JSON.stringify(body)
});
async function call(suffix, method, body) {
  const response = await request(suffix, method, body);
  const payload = await response.json();
  assert.equal(response.status, 200, JSON.stringify(payload));
  return payload;
}
const send = action => call('', 'POST', { action });
const width = 1280, height = 720;
const ffmpeg = args => spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...args], {
  windowsHide: true, stdio: ['ignore', 'pipe', 'ignore']
});
const receiver = ffmpeg(['-analyzeduration', '200000', '-probesize', '65536', '-i', 'udp://127.0.0.1:25202',
  '-an', '-vf', 'fps=4', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1']);
let frame, parts = [], length = 0;
receiver.stdout.on('data', chunk => {
  parts.push(chunk);
  length += chunk.length;
  if (length < width * height * 3) return;
  const data = Buffer.concat(parts);
  frame = data.subarray(0, width * height * 3);
  parts = [data.subarray(frame.length)];
  length -= frame.length;
});
function pixel(x, y) {
  const i = 3 * (width * y + x);
  return frame ? Array.from(frame.subarray(i, i + 3)) : [];
}
const blue = ([r, g, b]) => b > 200 && r < 40 && g < 40;
const red = ([r, g, b]) => r > 200 && g < 50 && b < 50;
const green = ([r, g, b]) => g > 205 && r < 50 && b < 50;
const blended = ([r, g, b]) => r < 35 && g > 98 && g < 160 && b > 98 && b < 160;
async function until(label, check) {
  const limit = Date.now() + 15000;
  while (!await check()) {
    if (Date.now() > limit) throw Error(label + ' timed out ' + [pixel(140, 150), pixel(10, 10)].join('/'));
    await sleep(100);
  }
  console.log(label);
}
let sender, browser;
try {
  const original = (await call('/watermark')).data;
  assert.deepEqual(original.canvas, { width, height });
  const logo = await sharp({ create: { width: 240, height: 120, channels: 4, background: '#00ff00ff' } }).png().toBuffer();
  let settings = { ...original.settings, image: 'data:image/png;base64,' + logo.toString('base64'), enabled: true,
    anchor: 'top-left', size: 20, x: 10, y: 20, opacity: 100, revision: 0 };
  for (const [role, org, code] of [['VIEWER', 'fixture', 403], ['SUPER_ADMIN', 'outside', 404]]) {
    assert.equal((await request('/watermark', 'PUT', settings, await token(role, org))).status, code);
  }
  await send('start');
  await until('Unmarked slate decoded', () => blue(pixel(140, 150)));
  if (process.env.MCR_TEST_PLAYWRIGHT) {
    const { chromium } = await import(process.env.MCR_TEST_PLAYWRIGHT);
    browser = await chromium.launch({ executablePath: process.env.MCR_TEST_CHROME });
    const context = await browser.newContext({ locale: 'en-US' });
    await context.addCookies([{ name: 'mcr_access_token', value: operator, url: origin }]);
    const page = await context.newPage();
    await page.goto(origin + '/live');
    await page.locator('summary').filter({ hasText: /Program watermark|شعار البرنامج/ }).click();
    const form = page.locator('details form');
    await form.locator('input[type=file]').setInputFiles({ name: 'fixture.png', mimeType: 'image/png', buffer: logo });
    await form.locator('input[type=checkbox]').check();
    await form.locator('select').selectOption('top-left');
    for (const [index, value] of [10, 20, 20, 100].entries()) await form.locator('input[type=number]').nth(index).fill(String(value));
    await form.locator('svg image[preserveAspectRatio]').waitFor();
    assert.equal((await call('/watermark')).data.revision, 0);
    assert(blue(pixel(140, 150)));
    await form.locator('button').filter({ hasText: /Apply to Program|تطبيق على البرنامج/ }).click();
    console.log('Browser pending Preview isolated from receiver, then explicitly applied');
  } else await call('/watermark', 'PUT', settings);
  await until('Applied green logo on blue slate', () => green(pixel(140, 150)));
  const applied = (await call('/watermark')).data;
  assert.equal(applied.revision, 1);
  assert.equal((await request('/watermark', 'PUT', settings)).status, 409);
  // Expected 256 x 128 at (128,144), rounded with codec edge tolerance.
  for (const [x,y] of [[130,146],[381,269]]) assert(green(pixel(x,y)));
  for (const [x,y] of [[124,150],[388,150],[140,140],[140,276]]) assert(blue(pixel(x,y)));
  await sharp(frame,{raw:{width,height,channels:3}}).png().toFile(join(directory,'marked-slate.png'));
  sender = ffmpeg(['-re', '-f','lavfi','-i','color=red:s=640x360:r=25','-f','lavfi','-i','sine=frequency=880',
    '-c:v','libx264','-tune','zerolatency','-g','25','-c:a','aac','-f','mpegts','udp://127.0.0.1:25200?pkt_size=1316']);
  await until('Contribution ready', async () => (await call('')).data.obs === 'ready');
  await send('obs');
  await until('Mark retained over switched contribution', () => red(pixel(10,10)) && green(pixel(140,150)));
  sender.kill();
  await until('Mark retained through automatic fallback', () => blue(pixel(10,10)) && green(pixel(140,150)));
  settings = { ...settings, revision: 1, anchor:'bottom-right', opacity:50 };
  await call('/watermark','PUT',settings);
  await until('Bottom-right 50% opacity at expected canvas coordinates', () =>
    blue(pixel(140,150)) && blended(pixel(900,450)) && blended(pixel(1149,573)) && blue(pixel(1156,576)));
  await send('stop');
  await send('start');
  await until('Restored revision after worker restart', async () => (await call('')).data.watermarkRevision === 2);
  await call('/watermark','PUT',{...settings, revision:2, anchor:'top-right'});
  await until('Top-right placement', () => blended(pixel(900,148)) && blended(pixel(1149,269)) && blue(pixel(900,450)));
  await call('/watermark','PUT',{...settings, revision:3, anchor:'bottom-left'});
  await until('Bottom-left placement', () => blended(pixel(132,450)) && blended(pixel(381,573)) && blue(pixel(900,148)));
  await call('/watermark','PUT',{...settings, revision:4, enabled:false});
  await until('Disable clears receiver pixels', () => blue(pixel(132,450)) && blue(pixel(381,573)));
  console.log('Receiver evidence', directory);
} finally {
  await browser?.close();
  sender?.kill();
  receiver.kill();
  await send('stop');
  server.closeAllConnections();
  server.close();
}
