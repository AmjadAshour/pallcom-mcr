/** Measure picture and audio marker timing on the same received MPEG-TS clock. */
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { setTimeout as sleep } from 'node:timers/promises';
import { programAction, programStatus } from '../src/infrastructure/program/supervisor.js';

const station = 'sync-loopback-fixture';
Object.assign(process.env, {
  MCR_PROGRAM_STATION_ID:station, MCR_PROGRAM_INPUT_PORT:'25550', MCR_PROGRAM_OUTPUT_PORT:'25552',
  MCR_PROGRAM_INPUT_HOST:'127.0.0.1', MCR_PROGRAM_INPUT_URL:'', MCR_PROGRAM_SECOND_INPUT_PORT:'',
  MCR_PROGRAM_SLATE:'blue', MCR_PROGRAM_AUTO_BACKUP:'0', MCR_PROGRAM_RECORDING_DIR:'', MCR_PROGRAM_HLS_DIR:'',
  MCR_PROGRAM_SRT_URL:'', MCR_PROGRAM_SRT_PASSPHRASE:'', MCR_PROGRAM_SECOND_SRT_URL:'', MCR_PROGRAM_SECOND_SRT_PASSPHRASE:'',
  MCR_PROGRAM_BLACK_SECONDS:'0', MCR_PROGRAM_FREEZE_SECONDS:'0', MCR_PROGRAM_SILENCE_SECONDS:'0',
});

const directory = mkdtempSync(join(tmpdir(), 'mcr-sync-fixture-'));
const source = join(directory, 'markers.ts');
const captured = join(directory, 'received.ts');
const video = "color=black:s=320x180:r=25,drawbox=color=white:t=fill:enable='lt(mod(t,2),0.4)'";
const audio = "aevalsrc='if(lt(mod(t,2),0.4),0.2*sin(2*PI*880*t),0)':s=48000";
const ffmpeg = (args) => promisify(execFile)('ffmpeg', ['-nostdin','-hide_banner',...args], {
  timeout:32000, windowsHide:true, maxBuffer:4*1024*1024,
});
await ffmpeg(['-loglevel','error','-f','lavfi','-i',video,'-f','lavfi','-i',audio,'-t','20',
  '-c:v','libx264','-tune','zerolatency','-g','25','-c:a','aac','-f','mpegts',source]);

async function markers(file) {
  const { stderr } = await ffmpeg(['-loglevel','info','-nostats','-copyts','-i',file,
    '-vf','showinfo','-af','silencedetect=n=-38dB:d=0.2','-f','null','-']);
  const flashes = [];
  let previouslyBright = false;
  for (const match of stderr.matchAll(/Parsed_showinfo_\d+[^\n]*?pts_time:\s*([\d.]+)[^\n]*?mean:\[\s*(\d+)/g)) {
    const bright = Number(match[2]) > 200;
    if (bright && !previouslyBright) flashes.push(Number(match[1]));
    previouslyBright = bright;
  }
  const tones = [...stderr.matchAll(/silence_end:\s*([\d.]+)/g)].map(match => Number(match[1]));
  return flashes.slice(1,-1).map(flash => {
    const closest = tones.reduce((best, value) => Math.abs(value-flash) < Math.abs(best-flash) ? value : best, Infinity);
    return Math.round((closest-flash)*1000);
  });
}

const reference = await markers(source);
assert(reference.length >= 4 && reference.every(delta => Math.abs(delta) <= 45), JSON.stringify(reference));
let sender;
const capture = ffmpeg(['-loglevel','error','-analyzeduration','400000','-probesize','32768',
  '-i','udp://127.0.0.1:25552','-t','17','-map','0:v:0','-map','0:a:0','-c','copy',captured]);
capture.catch(() => {});
try {
  await programAction(station, 'start');
  sender = spawn('ffmpeg', ['-nostdin','-loglevel','error','-re','-i',source,
    '-c','copy','-f','mpegts','udp://127.0.0.1:25550?pkt_size=1316'], { windowsHide:true, stdio:'ignore' });
  const deadline = performance.now() + 12000;
  while (programStatus(station).obs !== 'ready') {
    assert(performance.now() < deadline, 'Synthetic sync source did not become ready');
    await sleep(150);
  }
  await programAction(station, 'obs');
  await capture;
  const measured = await markers(captured);
  assert(measured.length >= 3 && measured.every(Number.isFinite), JSON.stringify(measured));
  const maxAbsoluteOffsetMs = Math.max(...measured.map(Math.abs));
  console.log(JSON.stringify({ referenceMs:reference, receiverMs:measured, maxAbsoluteOffsetMs }));
  assert(maxAbsoluteOffsetMs <= 100, 'Loopback A/V offset exceeded the 100 ms regression ceiling');
  console.log('Program receiver flash and tone timing measured');
} finally {
  if (sender && sender.exitCode === null && sender.signalCode === null) {
    const closed = once(sender, 'close');
    sender.kill();
    await closed;
  }
  await programAction(station, 'stop');
}
