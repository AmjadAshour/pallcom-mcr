import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import sharp from 'sharp';

const dbDir = mkdtempSync(join(tmpdir(),'mcr-control-restart-'));
const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
const secret = () => randomBytes(32).toString('hex');
const secondaryFixture = process.env.MCR_TEST_SECONDARY === '1';
const networkAction = secondaryFixture ? 'obs2' : 'obs';
const networkPort = secondaryFixture ? '25604' : '25603';
Object.assign(process.env, {
  NODE_ENV:'test', STORAGE_MODE:'sqlite', SQLITE_DB_PATH:join(dbDir,'fixture.sqlite'),
  MCR_BIND_HOST:'127.0.0.1', PORT:'25600', MCR_PROGRAM_RUNTIME_PORT:'25601',
  MCR_PROGRAM_OUTPUT_PORT:'25602', MCR_PROGRAM_INPUT_PORT:'25603', MCR_PROGRAM_SLATE:'blue',
  MCR_PROGRAM_SECOND_INPUT_PORT:secondaryFixture ? networkPort : '', MCR_PROGRAM_AUTO_BACKUP:'0', MCR_PROGRAM_INPUT_URL:'',
  MCR_PROGRAM_SRT_URL:'', MCR_PROGRAM_SRT_PASSPHRASE:'', MCR_PROGRAM_RECORDING_DIR:'',
  MCR_PROGRAM_AUTOSTART:'0',
  MCR_PROGRAM_RESTORE_SOURCE:'0',
  JWT_SECRET:secret(), REFRESH_TOKEN_SECRET:secret(), ENCRYPTION_MASTER_KEY:secret()
});
const { RepositoryFactory: repo } = await import('../src/infrastructure/repositories/repository-factory.js');
const { CryptoService } = await import('../src/infrastructure/security/crypto-service.js');
const { createSession } = await import('../src/infrastructure/security/session-service.js');
const { getSqliteDatabase } = await import('../src/infrastructure/database/sqlite.js');
const station = await repo.getStationRepository().create({name:'Restart fixture',organizationId:'fixture',encryptedPassword:'unused'});
const user = await repo.getUserRepository().create({email:'restart@fixture.local',fullName:'Operator',passwordHash:'unused',
  role:'OPERATOR',organizationId:'fixture'});
const token = CryptoService.signAccessToken({sub:user.id,sid:createSession(user.id).id});
process.env.MCR_PROGRAM_STATION_ID = station.id;
const base = 'http://127.0.0.1:25600';
const path = '/api/v1/stations/'+station.id+'/program';
const request = (action, authorized = true) => fetch(base+path, {
  method:action ? 'POST':'GET',
  headers:{...(authorized ? {Authorization:'Bearer '+token}:{}),'Content-Type':'application/json'},
  body:action ? JSON.stringify({action}):undefined
});
async function call(action) {
  const response = await request(action);
  assert.equal(response.status,200);
  return (await response.json()).data;
}
async function waitFor(test) {
  const deadline = Date.now()+15000;
  while (!await test()) {
    if (Date.now()>deadline) throw Error('Staging check timed out');
    await sleep(100);
  }
}
async function stop(process) {
  if (!process || process.exitCode !== null || process.signalCode !== null) return;
  const finished = once(process,'close');
  process.kill();
  await finished;
}
const launch = (script, extra = {}) => spawn(process.execPath,[script],
  {env:{...process.env,NODE_ENV:'development',...extra},windowsHide:true,stdio:'ignore'});
let runtime, web, receiver, sender;
let videoBytes=0, audioBytes=0;
let redFrames=0;
let yellowFrames=0, blueFrames=0, audibleChunks=0;
const contribution = () => spawn(ffmpeg,['-nostdin','-loglevel','error','-re','-f','lavfi','-i',
  'color=red:s=320x180:r=25','-f','lavfi','-i','sine=frequency=880','-c:v','libx264','-tune','zerolatency',
  '-g','25','-c:a','aac','-f','mpegts','udp://127.0.0.1:' + networkPort + '?pkt_size=1316'],{stdio:'ignore',windowsHide:true});
function startReceiver() {
  const decoder = spawn(ffmpeg,['-nostdin','-loglevel','error','-i','udp://127.0.0.1:25602','-map','0:v',
    '-vf','scale=1:1','-pix_fmt','rgb24','-f','rawvideo','pipe:1','-map','0:a','-f','s16le','pipe:3'],
    {stdio:['ignore','pipe','inherit','pipe'],windowsHide:true});
  let carry = Buffer.alloc(0);
  decoder.stdout.on('data',chunk=>{
    videoBytes+=chunk.length;
    const pixels = Buffer.concat([carry,chunk]);
    const end = pixels.length - pixels.length % 3;
    for (let i=0;i<end;i+=3) {
      const [red, green, blue] = pixels.subarray(i,i+3);
      if (red>180 && green<60 && blue<60) redFrames++;
      if (red>180 && green>180 && blue<60) yellowFrames++;
      if (blue>180 && red<60 && green<60) blueFrames++;
    }
    carry = pixels.subarray(end);
  });
  decoder.stdio[3].on('data',chunk=>{
    audioBytes+=chunk.length;
    for (let i=0;i+1<chunk.length;i+=2) {
      if (Math.abs(chunk.readInt16LE(i))>512) { audibleChunks++; break; }
    }
  });
  return decoder;
}
try {
  runtime=launch('backend/src/program-runtime.js');
  web=launch('backend/src/index.js');
  await waitFor(()=>fetch(base+path).then(r=>r.status===401).catch(()=>false));
  assert.equal((await request('start',false)).status,401);
  receiver=startReceiver();
  const started=await call('start');
  await waitFor(()=>videoBytes>15 && audioBytes>12000);
  await stop(web);
  web=null;
  await assert.rejects(fetch(base+'/health'));
  const videoBefore=videoBytes,audioBefore=audioBytes;
  await sleep(2400);
  assert(videoBytes-videoBefore>=120 && audioBytes-audioBefore>=192000,'Receiver stalled during web outage');
  web=launch('backend/src/index.js');
  await waitFor(()=>fetch(base+'/health').then(r=>r.ok).catch(()=>false));
  const restored=await call();
  assert.equal(restored.session,started.session);
  assert.equal(restored.state,'running');
  assert.equal((await call('mute')).programMuted,true);
  console.log('Control restart receiver passed');
  await stop(runtime);
  runtime=null;
  assert.equal((await request()).status,503);
  await stop(receiver);
  videoBytes=audioBytes=0;
  receiver=startReceiver();
  const db = getSqliteDatabase();
  db.prepare('INSERT INTO program_watermarks VALUES (?,?,?,?)').run(station.id, 3, '{}', '');
  db.prepare('INSERT INTO program_ads VALUES (?,?)').run(station.id,
    JSON.stringify({revision:4,zone:'UTC',placements:[],transport:{}}));
  runtime=launch('backend/src/program-runtime.js',{MCR_PROGRAM_AUTOSTART:'1'});
  await waitFor(async()=>{
    const response=await request();
    if (!response.ok) return false;
    const current=(await response.json()).data;
    return current.state==='running' && current.watermarkRevision===3 && current.adsRevision===4;
  });
  await waitFor(()=>videoBytes>15 && audioBytes>12000);
  const restarted=await call();
  assert.notEqual(restarted.session,started.session);
  assert.equal(restarted.source,'fallback');
  console.log('Program runtime auto-start receiver passed');
  sender=contribution();
  await waitFor(async()=> (await call())[networkAction]==='ready');
  assert.equal((await call(networkAction)).source, networkAction);
  await waitFor(()=>redFrames>10);
  await stop(runtime);
  await stop(sender);
  await stop(receiver);
  redFrames=videoBytes=audioBytes=0;
  receiver=startReceiver();
  runtime=launch('backend/src/program-runtime.js',{MCR_PROGRAM_AUTOSTART:'1',MCR_PROGRAM_RESTORE_SOURCE:'1'});
  await waitFor(async()=>{
    const response=await request();
    return response.ok && (await response.json()).data.state==='running';
  });
  await waitFor(()=>videoBytes>15);
  assert.equal((await call()).source,'fallback');
  assert.equal(redFrames,0);
  sender=contribution();
  await waitFor(async()=>redFrames>10 && (await call()).source===networkAction);
  assert.notEqual((await call()).session,restarted.session);
  console.log('Saved source restored on receiver');
  async function sceneRequest(suffix, method, body, type='application/json') {
    const response=await fetch(base+path+suffix,{method,headers:{Authorization:'Bearer '+token,'Content-Type':type},
      body:Buffer.isBuffer(body) ? body : JSON.stringify(body)});
    const payload=await response.json();
    assert(response.ok,payload.error);
    return payload.data;
  }
  const clip=join(dbDir,'restore-fixture.mp4');
  execFileSync(ffmpeg,['-nostdin','-loglevel','error','-f','lavfi','-i','color=yellow:s=320x180:r=25',
    '-f','lavfi','-i','sine=frequency=440','-t','2','-c:v','libx264','-c:a','aac',clip],{windowsHide:true});
  const image=await sharp({create:{width:32,height:32,channels:3,background:'#00ff00'}}).png().toBuffer();
  const video=await sceneRequest('/ads/assets?name=restore-video','POST',readFileSync(clip),'video/mp4');
  const overlay=await sceneRequest('/ads/assets?name=restore-overlay','POST',image,'image/png');
  const localScene={id:crypto.randomUUID(),name:'Restore scene',video:video.id,image:overlay.id,x:5,y:5,w:10,h:10};
  await sceneRequest('/local-scene','PUT',localScene);
  assert.equal((await sceneRequest('/local-scene/take','POST',localScene)).source,'scene');
  await waitFor(()=>yellowFrames>10);
  const localSession=(await call()).session;
  await stop(runtime);
  await stop(sender);
  await stop(receiver);
  yellowFrames=blueFrames=audibleChunks=0;
  receiver=startReceiver();
  const recovery={MCR_PROGRAM_AUTOSTART:'1',MCR_PROGRAM_RESTORE_SOURCE:'1'};
  runtime=launch('backend/src/program-runtime.js',recovery);
  await waitFor(()=>yellowFrames>10 && audibleChunks>3);
  const recoveredLocal=await call();
  assert.notEqual(recoveredLocal.session,localSession);
  assert.equal(recoveredLocal.source,'scene');
  const monitor=await (await fetch(base+path+'/program-monitor',{headers:{Authorization:'Bearer '+token}})).json();
  const frame=await sharp(Buffer.from(monitor.data.split(',')[1],'base64')).resize(160,90).raw().toBuffer();
  const point=(x,y)=>[...frame.subarray(3*(y*160+x),3*(y*160+x)+3)];
  assert(point(16,9)[1]>180 && point(16,9)[0]<70);

  await stop(runtime);
  await stop(receiver);
  const removed=db.prepare('DELETE FROM ad_frames WHERE stationId=? AND asset=? AND frame=0').run(station.id,video.id);
  assert.equal(removed.changes,1);
  yellowFrames=blueFrames=audibleChunks=0;
  receiver=startReceiver();
  runtime=launch('backend/src/program-runtime.js',recovery);
  await waitFor(()=>blueFrames>25);
  const missing=await call();
  assert.notEqual(missing.session,recoveredLocal.session);
  assert.equal(missing.source,'fallback');
  assert.equal(missing.sourceRecovery,'unavailable');
  assert.equal(yellowFrames,0);
  assert.equal(audibleChunks,0);
  console.log('Local scene restart and missing media passed');
  await call('stop');
  assert.equal((await call()).state,'stopped');
} finally {
  if (web) await request('stop').catch(()=>{});
  await stop(receiver);
  await stop(sender);
  await stop(web);
  await stop(runtime);
}
