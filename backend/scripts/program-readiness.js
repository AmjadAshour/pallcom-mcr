/** Observe decoded video/audio from a dedicated loopback Program receiver. */
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { setTimeout as sleep } from 'node:timers/promises';

const [input, durationArg = '60', toleratedArg = '0', extra] = process.argv.slice(2);
const seconds = Number(durationArg);
const toleratedSeconds = Number(toleratedArg);
const match = /^udp:\/\/127\.0\.0\.1:(\d+)$/.exec(input ?? '');
if (!match || Number(match[1]) < 1024 || Number(match[1]) > 65535 || !Number.isInteger(seconds) ||
    seconds < 1 || seconds > 259200 || !Number.isInteger(toleratedSeconds) ||
    toleratedSeconds < 0 || toleratedSeconds > seconds || extra !== undefined) {
  console.error('Usage: node backend/scripts/program-readiness.js udp://127.0.0.1:<port> [seconds <= 259200] [allowed-outage-seconds]');
  process.exit(2);
}

const emit = (event, details) => console.log(JSON.stringify({ at:new Date().toISOString(), event, ...details }));
const child = spawn(process.env.FFMPEG_PATH || 'ffmpeg', ['-nostdin','-hide_banner','-loglevel','info','-nostats',
  '-analyzeduration','500000','-probesize','65536','-i',input,'-map','0:v:0?','-map','0:a:0?',
  '-vf','showinfo','-af','ashowinfo','-f','null','-'], { windowsHide:true, stdio:['ignore','ignore','pipe'] });
const done = once(child, 'close');
done.catch(() => {});
const tracks = { video:null, audio:null };
let frames = 0, audioBuffers = 0;
const lines = createInterface({ input:child.stderr });
lines.on('line', line => {
  const match = /Parsed_(a?showinfo)_\d+.*\bpts_time:\s*(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)/i.exec(line);
  if (!match) return;
  const sample = { at:performance.now(), pts:Number(match[2]) };
  if (match[1] === 'showinfo') { tracks.video = sample; frames++; }
  else { tracks.audio = sample; audioBuffers++; }
});

const started = performance.now();
let previousAt = started, state, seenHealthy = false, outageMs = 0, maxHeadDeltaMs = 0;
let startupMs, nextCheckpoint = started + 60000;
let stopping = false, childError = false;
process.once('SIGINT', () => { stopping = true; });
process.once('SIGTERM', () => { stopping = true; });
child.once('error', () => { childError = true; });
function sampleHealth(now) {
  const video = tracks.video && now - tracks.video.at < 2000;
  const audio = tracks.audio && now - tracks.audio.at < 2000;
  return video && audio ? 'decoding' : video ? 'video-only' : audio ? 'audio-only' : 'no-media';
}
try {
  while (!stopping && !childError && child.exitCode === null && child.signalCode === null) {
    const now = performance.now();
    const next = sampleHealth(now);
    if (seenHealthy && next !== 'decoding') outageMs += now - previousAt;
    if (next === 'decoding') {
      startupMs ??= Math.round(now - started);
      seenHealthy = true;
      maxHeadDeltaMs = Math.max(maxHeadDeltaMs, Math.abs(tracks.video.pts - tracks.audio.pts) * 1000);
    }
    if (state !== next) {
      state = next;
      emit('state', { state, frames, audioBuffers });
    }
    if (now >= nextCheckpoint) {
      emit('checkpoint', { state, frames, audioBuffers, outageMs:Math.round(outageMs),
        maxDecodedHeadDeltaMs:Math.round(maxHeadDeltaMs) });
      nextCheckpoint = now + 60000;
    }
    previousAt = now;
    if (now - started >= seconds * 1000) break;
    await sleep(250);
  }
  const elapsedMs = Math.round(performance.now() - started);
  const completed = !stopping && !childError && child.exitCode === null && child.signalCode === null &&
    elapsedMs >= seconds * 1000 && startupMs <= 15000 && state === 'decoding' && outageMs <= toleratedSeconds * 1000;
  emit('summary', { completed, elapsedMs, startupMs, frames, audioBuffers, outageMs:Math.round(outageMs),
    maxDecodedHeadDeltaMs:Math.round(maxHeadDeltaMs) });
  if (!completed) process.exitCode = 1;
} finally {
  child.kill();
  await done.catch(() => {});
  lines.close();
}
