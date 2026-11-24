/** Run explicitly on a local staging host with FFmpeg and the configured worker runtime. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { programAction, programStatus } from '../src/infrastructure/program/supervisor.js';

const station = 'isolated-program-fixture';
process.env.MCR_PROGRAM_STATION_ID = station;
process.env.MCR_PROGRAM_SLATE = 'blue';
process.env.MCR_PROGRAM_INPUT_PORT ||= '25100';
process.env.MCR_PROGRAM_OUTPUT_PORT ||= '25102';
const input = 'udp://127.0.0.1:' + process.env.MCR_PROGRAM_INPUT_PORT;
const output = 'udp://127.0.0.1:' + process.env.MCR_PROGRAM_OUTPUT_PORT;
const ffmpeg = (args, stdio = 'ignore') => spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...args], { windowsHide: true, stdio });
const decoder = ffmpeg(['-analyzeduration', '300000', '-probesize', '65536', '-i', output,
  '-an', '-vf', 'scale=1:1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1'], ['ignore', 'pipe', 'inherit']);
let frames = 0, rgb, remainder = Buffer.alloc(0);
decoder.stdout.on('data', chunk => {
  const pixels = Buffer.concat([remainder, chunk]);
  const end = pixels.length - pixels.length % 3;
  if (end) rgb = pixels.subarray(end - 3, end);
  frames += end / 3;
  remainder = pixels.subarray(end);
});
async function until(label, predicate, timeout = 20000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeout) throw Error(label + ' timed out: ' + JSON.stringify({ rgb, frames, status: programStatus(station) }));
    await sleep(50);
  }
  console.log(label, JSON.stringify({ frames, rgb: [...(rgb || [])], ...programStatus(station) }));
}
const blue = () => rgb && rgb[2] > 180 && rgb[0] < 50;
const red = () => rgb && rgb[0] > 180 && rgb[2] < 50;
const ready = () => programStatus(station).obs === 'ready';
const send = action => programAction(station, action);
const contribute = () => ffmpeg(['-re', '-f', 'lavfi', '-i', 'color=red:s=640x360:r=25',
  '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=48000', '-c:v', 'libx264',
  '-tune', 'zerolatency', '-g', '25', '-c:a', 'aac', '-f', 'mpegts', input + '?pkt_size=1316']);
let sender;
try {
  const { session } = await send('start');
  await until('Cold Program decoded by independent receiver', blue);
  sender = contribute();
  await until('Contribution ready', ready);
  await send('obs');
  await until('Contribution decoded on Program', red);
  sender.kill();
  await until('Loss replaced by slate', () => blue() && programStatus(station).obs === 'disconnected');
  sender = contribute();
  await until('Reconnected input held off air', () => ready() && blue());
  await send('obs');
  await until('Explicit retake decoded', red);
  assert.equal(programStatus(station).session, session);
} finally {
  sender?.kill();
  decoder.kill();
  await send('stop');
}
