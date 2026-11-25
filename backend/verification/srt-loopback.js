/** Exercise SRT loss and recovery with two independent FFmpeg receivers. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import { programAction, programStatus } from '../src/infrastructure/program/supervisor.js';

const station = 'isolated-srt-fixture';
Object.assign(process.env, {
  MCR_PROGRAM_STATION_ID: station, MCR_PROGRAM_SLATE: 'blue',
  MCR_PROGRAM_INPUT_PORT: '25500', MCR_PROGRAM_OUTPUT_PORT: '25502',
  MCR_PROGRAM_SRT_URL: 'srt://127.0.0.1:25504?mode=caller&latency=120'
});
const receiverUrl = 'srt://127.0.0.1:25504?mode=listener&latency=120000';
const encrypted = process.env.MCR_TEST_SRT_ENCRYPTED === '1';
if (encrypted) process.env.MCR_PROGRAM_SRT_PASSPHRASE = randomBytes(20).toString('hex');
const correctUrl = encrypted ? receiverUrl + '&pbkeylen=32&passphrase=' + process.env.MCR_PROGRAM_SRT_PASSPHRASE : receiverUrl;
const send = action => programAction(station, action);
function receive(url) {
  const process = spawn('ffmpeg', ['-hide_banner','-loglevel','error','-analyzeduration','1500000',
    '-probesize','262144','-i',url,'-map','0:v','-vf','scale=1:1','-pix_fmt','rgb24','-f','rawvideo','pipe:1',
    '-map','0:a','-f','s16le','pipe:3'],
    {windowsHide:true,stdio:['ignore','pipe','ignore','pipe']});
  const result = { process, frames:0, blue:false, audioBytes:0 };
  process.stdio[3].on('data', chunk => { result.audioBytes += chunk.length; });
  let carry = Buffer.alloc(0);
  process.stdout.on('data', data => {
    const bytes = Buffer.concat([carry,data]);
    const end = bytes.length - bytes.length % 3;
    if (end) {
      const [r,g,b] = bytes.subarray(end-3,end);
      result.blue ||= b>180 && r<50 && g<50;
      result.frames += end/3;
    }
    carry = bytes.subarray(end);
  });
  return result;
}
async function stop(receiver) {
  const process = receiver?.process;
  if (!process || process.exitCode !== null || process.signalCode !== null) return;
  const closed = once(process,'close');
  process.kill();
  await closed;
}
async function until(label, check) {
  const deadline = Date.now()+24000;
  while (!check()) {
    if (Date.now()>deadline) throw Error(label + ': ' + JSON.stringify(programStatus(station)));
    await sleep(80);
  }
  console.log(label);
}
const local = receive('udp://127.0.0.1:25502');
let remote = receive(encrypted ? receiverUrl + '&pbkeylen=32&passphrase=' + randomBytes(20).toString('hex') : receiverUrl);
try {
  const {session} = await send('start');
  if (encrypted) {
    await until('Encrypted destination retries with wrong key', () => local.frames > 100 && programStatus(station).srt === 'retrying');
    assert.equal(remote.frames, 0);
    assert.equal(remote.audioBytes, 0);
    assert.equal(programStatus(station).srtEncrypted, true);
    assert(!JSON.stringify(programStatus(station)).includes(process.env.MCR_PROGRAM_SRT_PASSPHRASE));
    await stop(remote);
    remote = receive(correctUrl);
  }
  await until('SRT and UDP decoded Program audio and video',()=>local.blue && remote.blue &&
    local.audioBytes>12000 && remote.audioBytes>12000 && programStatus(station).srt==='sending');
  await stop(remote);
  const before = local.frames;
  await until('UDP continues while SRT retries',()=>local.frames>before+50 && programStatus(station).srt==='retrying');
  remote = receive(correctUrl);
  await until('New SRT receiver decoded Program audio and video',()=>remote.blue &&
    remote.audioBytes>12000 && programStatus(station).srt==='sending');
  assert.equal(programStatus(station).session,session);
  console.log('SRT recovery and local output passed');
  if (encrypted) console.log('Encrypted SRT authentication and recovery passed');
} finally {
  await send('stop');
  await stop(remote);
  await stop(local);
}
