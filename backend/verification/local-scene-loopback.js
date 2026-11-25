/** Local staging acceptance, including measured timing in a separately decoded transport stream. */
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { setTimeout as sleep } from 'node:timers/promises';
import sharp from 'sharp';
const dir = mkdtempSync(join(tmpdir(), 'mcr-local-scene-'));
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
const green = await upload('green', await solid('#00ff00'), 'image/png');
await ffmpeg(['-f','lavfi','-i','color=red:s=320x180:r=25:d=0.5','-f','lavfi','-i','color=yellow:s=320x180:r=25:d=0.5',
  '-f','lavfi','-i','sine=frequency=880:duration=1','-filter_complex','[0:v][1:v]concat=n=2:v=1:a=0[v]',
  '-map','[v]','-map','2:a','-c:v','libx264','-c:a','aac','fixture.mp4']);
const video = await upload('video', readFileSync(join(dir,'fixture.mp4')), 'video/mp4');
const scene = { video:video.id, image:green.id, x:10,y:10,w:20,h:20 };
let browser, sender, secondSender;
const automaticBackup = process.env.MCR_TEST_AUTO_BACKUP === '1';
process.env.MCR_PROGRAM_AUTO_BACKUP = automaticBackup ? '1' : '0';
try {
  const watermark = await call('/watermark');
  assert((await request('/watermark','PUT',{...watermark.settings,revision:0,enabled:true,
    image:'data:image/png;base64,'+(await solid('#ffffff')).toString('base64')})).ok);
  const ad = await upload('magenta', await solid('#ff00ff'), 'image/png');
  await call('/ads','PUT',{revision:0,zone:'UTC',placements:[{
    id:crypto.randomUUID(),name:'Fixture',enabled:true,x:60,y:60,w:20,h:20,z:1,startLocal:'',endLocal:'',
    items:[{asset:ad.id,duration:15000,gap:0,enter:0,exit:0,dx:0,dy:0}]
  }]});
  process.env.MCR_PROGRAM_RECORDING_DIR = dir;
  process.env.MCR_PROGRAM_SECOND_INPUT_PORT = '25304';
  const {session, recordingFile} = await send('start');
  const network = { id:crypto.randomUUID(), name:'Network scene', type:'network' };
  const backup = { ...network, id:crypto.randomUUID(), name:'Input two scene', input:'secondary' };
  assert((await request('/local-scene','PUT',network)).ok);
  assert.equal((await request('/local-scene/take','POST',network)).status,409);
  sender = spawn('ffmpeg', ['-nostdin','-loglevel','error','-re','-f','lavfi','-i','color=white:s=320x180:r=25',
    '-f','lavfi','-i','sine=frequency=880','-c:v','libx264','-tune','zerolatency','-g','25','-c:a','aac',
    '-f','mpegts','udp://127.0.0.1:25300?pkt_size=1316'], {stdio:'ignore',windowsHide:true});
  secondSender = spawn('ffmpeg', ['-nostdin','-loglevel','error','-re','-f','lavfi','-i','color=green:s=320x180:r=25',
    '-f','lavfi','-i','sine=frequency=440','-c:v','libx264','-tune','zerolatency','-g','25','-c:a','aac',
    '-f','mpegts','udp://127.0.0.1:25304?pkt_size=1316'], {stdio:'ignore',windowsHide:true});
  const movie = join(dir,'scene.ts');
  const capture = ffmpeg(['-analyzeduration','200000','-probesize','65536','-i','udp://127.0.0.1:25302','-t','14','-c','copy',movie]);
  capture.catch(()=>{});
  await sleep(1200);
  assert((await request('/local-scene','PUT',scene)).ok);
  assert.deepEqual(await call('/local-scene'),scene);
  const secondImage = await upload('cyan', await solid('#00ffff'), 'image/png');
  const second = { ...scene, id:crypto.randomUUID(), name:'Second scene', image:secondImage.id };
  assert((await request('/local-scene','PUT',second)).ok);
  assert.deepEqual(await call('/local-scene/library'),[scene, network, second]);
  assert((await request('/local-scene','PUT',backup)).ok);
  assert.equal((await request('/local-scene/take','POST',{ ...second, x:12 })).status,409);
  assert.equal((await request('/ads/assets/'+secondImage.id,'DELETE')).status,409);
  assert.equal((await call('')).source,'fallback');
  const draftPreview = await call('/local-scene/preview','POST',scene);
  const previewPixels = await sharp(Buffer.from(draftPreview.split(',')[1], 'base64')).resize(160,90).raw().toBuffer();
  const previewPoint = (x,y) => [...previewPixels.subarray(3*(y*160+x),3*(y*160+x)+3)];
  assert(previewPoint(80,45)[0]>180 && previewPoint(80,45)[1]<60 && previewPoint(20,12)[1]>180);
  assert.equal((await call('')).source,'fallback');
  assert.equal((await request('/ads/assets/'+green.id,'DELETE')).status,409);
  await sleep(900);
  assert.equal((await call('/local-scene/take','POST',scene)).source,'scene');
  await sleep(1200);
  const monitor = await call('/program-monitor');
  const picture = await sharp(Buffer.from(monitor.split(',')[1], 'base64')).resize(160,90).raw().toBuffer();
  const point = (x,y) => [...picture.subarray(3*(y*160+x),3*(y*160+x)+3)];
  assert(point(80,45)[0]>180 && point(20,12)[1]>180);
  assert(point(150,5).every(value=>value>210));
  assert(point(112,63)[0]>210 && point(112,63)[2]>210);
  const secondTake = await call('/local-scene/take','POST',second);
  assert.equal(secondTake.session,session);
  await sleep(1300);
  assert.equal((await send('fallback')).session,session);
  await sleep(2800);
  const inputPreview = await call('/input-preview');
  const incoming = await sharp(Buffer.from(inputPreview.split(',')[1], 'base64')).resize(1,1).raw().toBuffer();
  assert(incoming.every(value=>value>210));
  const input2Preview = await call('/input-preview?input=secondary');
  const input2 = await sharp(Buffer.from(input2Preview.split(',')[1], 'base64')).resize(1,1).raw().toBuffer();
  assert(input2[1]>90 && input2[0]<50 && input2[2]<50);
  assert.equal((await call('')).source,'fallback');
  assert.equal((await call('/local-scene/take','POST',backup)).source,'obs2');
  await sleep(1500);
  assert.equal((await request('/local-scene/take?transition=unknown','POST',network)).status,400);
  const networkTake = await call('/local-scene/take?transition=fade','POST',network);
  assert.equal(networkTake.session,session);
  assert.equal(networkTake.source,'obs');
  await sleep(1400);
  if (automaticBackup) {
    sender.kill();
    await sleep(1600);
    const afterLoss = await call('');
    assert.equal(afterLoss.obs,'disconnected');
    assert.equal(afterLoss.source,'obs2');
    assert.equal(afterLoss.session,session);
    secondSender.kill();
  } else {
    secondSender.kill();
    await sleep(1600);
    const afterLoss = await call('');
    assert.equal(afterLoss.obs2,'disconnected');
    assert.equal(afterLoss.source,'obs');
    assert.equal(await call('/input-preview?input=secondary'),null);
    sender.kill();
  }
  await sleep(1300);
  assert.equal((await call('')).source,'fallback');
  await capture;
  const {stdout} = await ffmpeg(['-i',movie,'-an','-vf','fps=5,scale=160:90','-pix_fmt','rgb24','-f','rawvideo','pipe:1'],
    {encoding:'buffer',maxBuffer:10*1024*1024});
  const pixels = [];
  for(let offset=0;offset+43200<=stdout.length;offset+=43200){
    const pixel=(x,y)=>[...stdout.subarray(offset+3*(y*160+x),offset+3*(y*160+x)+3)];
    pixels.push([pixel(80,45),pixel(20,12),pixel(150,5),pixel(112,63)]);
  }
  const blue=([r,g,b])=>b>180&&r<70&&g<70;
  const marked=([r,g,b])=>g>180&&r<70&&b<70;
  assert(blue(pixels[0][0]));
  assert(!marked(pixels[0][1]));
  console.log('Worker scene preview isolation passed');
  assert(pixels.some(([p,m])=>p[0]>180&&p[1]<70&&marked(m)));
  assert(pixels.some(([p,m])=>p[0]>180&&p[1]>180&&marked(m)));
  assert(pixels.some(([,m,logo,ad])=>marked(m)&&logo.every(x=>x>210)&&ad[0]>210&&ad[1]<60&&ad[2]>210));
  assert(pixels.some(([,m,logo,ad])=>m[0]<50&&m[1]>200&&m[2]>200&&
    logo.every(x=>x>210)&&ad[0]>210&&ad[1]<60&&ad[2]>210));
  console.log('Multiple saved scenes receiver passed');
  assert(pixels.some(([center,,logo,ad])=>center.every(value=>value>210) &&
    logo.every(value=>value>210) && ad[0]>210 && ad[1]<60 && ad[2]>210));
  console.log('Saved network scene receiver passed');
  assert(pixels.some(([center])=>center[1]>90 && center[0]<50 && center[2]<50));
  console.log('Dual input receiver passed');
  const fading = pixels.findIndex(([center,,logo,ad]) => Math.min(...center)>30 && Math.max(...center)<205 &&
    Math.max(...center)-Math.min(...center)<12 && logo.every(value=>value>210) && ad[0]>210 && ad[2]>210);
  assert(fading>=0 && pixels.slice(fading+1).some(([center])=>center.every(value=>value>210)));
  console.log('Scene fade receiver passed');
  assert(blue(pixels.at(-1)[0])&&!marked(pixels.at(-1)[1]));
  if (automaticBackup) {
    const whiteIndex = pixels.findIndex(([center])=>center.every(value=>value>210));
    assert(whiteIndex>=0 && pixels.slice(whiteIndex+1).some(([center,,logo,ad])=>
      center[1]>90 && center[0]<50 && center[2]<50 && logo.every(value=>value>210) && ad[0]>210 && ad[2]>210));
    console.log('Automatic backup receiver passed');
  }
  const sound = (await ffmpeg(['-i',movie,'-vn','-ac','1','-ar','8000','-f','s16le','pipe:1'],{encoding:'buffer'})).stdout;
  function level(second) {
    let squares = 0;
    for (let i = second * 16000; i < second * 16000 + 8000; i += 2) squares += sound.readInt16LE(i) ** 2;
    return Math.sqrt(squares / 4000);
  }
  assert(level(0)<10 && level(3)>500 && level(6)<10, 'Scene audio should air only during the take');
  console.log('Local scene receiver passed', movie);
  const stopped = await send('stop');
  assert.equal(stopped.recording, 'completed');
  assert.equal(await call('/program-monitor'),null);
  console.log('Composed Program monitor passed');
  if (process.env.MCR_TEST_PLAYWRIGHT) {
    await send('start');
    const { chromium } = await import(process.env.MCR_TEST_PLAYWRIGHT);
    browser = await chromium.launch({ executablePath: process.env.MCR_TEST_CHROME });
    const origin = new URL(root).origin;
    const context = await browser.newContext({ viewport:{width:1400,height:900} });
    await context.addCookies([{name:'mcr_access_token',value:operator,url:origin}]);
    const page = await context.newPage();
    await page.goto(origin + '/live');
    const output = page.locator('figure').filter({hasText:/Program picture monitor|مراقبة صورة Program/});
    const input = page.locator('figure').filter({hasText:/Input Preview \(OBS|معاينة المدخل/});
    await output.locator('img').waitFor();
    await input.getByText(/Waiting for input|بانتظار الإشارة/).waitFor();
    const wideInput = await input.boundingBox();
    const wideOutput = await output.boundingBox();
    assert.equal(wideInput.y, wideOutput.y);
    assert.notEqual(wideInput.x, wideOutput.x);
    await page.setViewportSize({width:600,height:900});
    const narrowInput = await input.boundingBox();
    const narrowOutput = await output.boundingBox();
    assert(narrowOutput.y > narrowInput.y);
    await send('stop');
    await output.waitFor({state:'detached'});
    console.log('Responsive Live Control monitors passed');
  }
  assert.equal(stopped.recordingFile, recordingFile);
  const recording = join(dir, recordingFile);
  async function hashes(media, type) {
    const { stdout } = await ffmpeg(['-i',media,'-map',type,'-f','framemd5','pipe:1']);
    return stdout.split(/\r?\n/).filter(line => /^\d+,/.test(line)).map(line=>line.split(',').at(-1).trim());
  }
  for (const type of ['0:v','0:a']) {
    const live = await hashes(movie, type);
    const file = await hashes(recording, type);
    const key = live.slice(Math.floor(live.length / 3), Math.floor(live.length / 3) + 30).join(',');
    assert(live.length > 100 && file.join(',').includes(key), 'Recording differs from live ' + type);
  }
  process.env.MCR_PROGRAM_RECORDING_DIR = join(dir, 'missing-directory');
  await send('start');
  await sleep(400);
  const failed = await call('');
  assert.equal(failed.state, 'running');
  assert.equal(failed.recording, 'failed');
  console.log('Program recording matches receiver', recording);
} finally {
  sender?.kill();
  secondSender?.kill();
  await browser?.close();
  await send('stop');
  server.closeAllConnections();
  server.close();
}
