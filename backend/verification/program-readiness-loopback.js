import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { programAction } from '../src/infrastructure/program/supervisor.js';

const station = 'readiness-loopback-fixture';
Object.assign(process.env, {
  MCR_PROGRAM_STATION_ID:station, MCR_PROGRAM_INPUT_PORT:'25540', MCR_PROGRAM_OUTPUT_PORT:'25542',
  MCR_PROGRAM_INPUT_HOST:'127.0.0.1', MCR_PROGRAM_INPUT_URL:'', MCR_PROGRAM_SECOND_INPUT_PORT:'',
  MCR_PROGRAM_SLATE:'blue', MCR_PROGRAM_AUTO_BACKUP:'0', MCR_PROGRAM_RECORDING_DIR:'', MCR_PROGRAM_HLS_DIR:'',
  MCR_PROGRAM_SRT_URL:'', MCR_PROGRAM_SRT_PASSPHRASE:'', MCR_PROGRAM_SECOND_SRT_URL:'', MCR_PROGRAM_SECOND_SRT_PASSPHRASE:'',
});
const script = fileURLToPath(new URL('../scripts/program-readiness.js', import.meta.url));
const sampleSeconds = Number(process.env.MCR_READINESS_FIXTURE_SECONDS || 20);
assert(Number.isInteger(sampleSeconds) && sampleSeconds >= 20 && sampleSeconds <= 300);
const observer = spawn(process.execPath, [script,'udp://127.0.0.1:25542',String(sampleSeconds),'8'],
  { windowsHide:true, stdio:['ignore','pipe','inherit'] });
const events = [];
const lines = createInterface({ input:observer.stdout });
lines.on('line', line => events.push(JSON.parse(line)));
const finished = once(observer, 'close');
async function state(target, after = 0) {
  const limit = Date.now() + 7000;
  while (!events.slice(after).some(event => event.event === 'state' && event.state === target)) {
    if (Date.now() >= limit) throw Error(target + ' not observed: ' + JSON.stringify(events));
    await sleep(70);
  }
}
try {
  const first = await programAction(station, 'start');
  await state('decoding');
  await programAction(station, 'stop');
  await state('no-media', events.findIndex(event => event.state === 'decoding') + 1);
  const disconnected = events.length;
  const second = await programAction(station, 'start');
  assert.notEqual(second.session, first.session);
  await state('decoding', disconnected);
  const [exit] = await finished;
  assert.equal(exit, 0, JSON.stringify(events));
  const summary = events.find(event => event.event === 'summary');
  assert(summary.completed && summary.elapsedMs >= sampleSeconds * 1000 && summary.frames > 100 && summary.audioBuffers > 100);
  assert(summary.outageMs >= 250 && Number.isFinite(summary.maxDecodedHeadDeltaMs));
  console.log(JSON.stringify(summary));
  console.log('Program readiness fault drill passed');
} finally {
  observer.kill();
  await finished.catch(() => {});
  lines.close();
  await programAction(station, 'stop');
}
