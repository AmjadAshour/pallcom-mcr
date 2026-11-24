import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { PROGRAM_CANVAS } from '@mcr/shared';

const worker = fileURLToPath(new URL('./worker.py', import.meta.url));
const failure = (message, statusCode = 409) => Object.assign(new Error(message), { statusCode });
let child;
let pending;
let watchdog;
let frame = null;
let renderer;
export function updateAds(plan) { renderer?.update(plan); }
export const previewFrame = () => frame;
export function updateWatermark(packet) {
  if (child && status.state !== 'stopping') child.stdin.write(JSON.stringify(packet) + '\n');
}
let status = { state: 'stopped' };

export function configured(id) {
  return id === process.env.MCR_PROGRAM_STATION_ID;
}

export function programStatus(id) {
  return configured(id) ? { configured: true, ...status } : { configured: false };
}

function settle(error) {
  if (!pending) return;
  clearTimeout(pending.timer);
  if (error) pending.reject(error);
  else pending.resolve({ configured: true, ...status });
  pending = undefined;
}

function waitFor(action) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      settle(failure('Program worker timed out', 503));
      child?.kill();
    }, 15000);
    pending = { action, resolve, reject, timer };
  });
}

function port(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1024 || number > 65535) throw failure('Invalid Program port configuration', 503);
  return number;
}

function start(watermark, ads) {
  const input = port(process.env.MCR_PROGRAM_INPUT_PORT || 5100);
  const output = port(process.env.MCR_PROGRAM_OUTPUT_PORT || 5102);
  const slate = process.env.MCR_PROGRAM_SLATE || 'bars';
  if (input === output || !['black', 'blue', 'bars'].includes(slate)) throw failure('Invalid Program configuration', 503);
  const env = {};
  for (const key of Object.keys(process.env)) {
    if (/^(path|systemroot|windir|temp|tmp|home|userprofile|localappdata|appdata|lang|ld_library_path|gst_registry|gst_plugin_path)$/i.test(key)) env[key] = process.env[key];
  }
  const proc = spawn(process.env.MCR_PROGRAM_PYTHON || 'python', ['-u', worker, String(input), String(output), slate],
    { env, windowsHide: true, stdio: ['pipe', 'pipe', 'inherit'] });
  child = proc;
  renderer = ads;
  let waitingForAds = false;
  const adTimer = ads && setInterval(() => {
    if (waitingForAds || status.state !== 'running' || proc.stdin.destroyed || proc.stdin.writableNeedDrain) return;
    const packet = ads.draw(Date.now(), Math.round(performance.timeOrigin + performance.now()));
    if (packet) {
      waitingForAds = true;
      proc.stdin.write(JSON.stringify(packet) + '\n');
    }
  }, 40);
  status = { state: 'starting', session: randomUUID(), source: 'fallback', obs: 'disconnected', outputPort: output };
  const result = waitFor('start');
  proc.stdin.on('error', () => proc.kill());
  proc.stdin.write(JSON.stringify({ canvas: PROGRAM_CANVAS, ...watermark }) + '\n');
  proc.on('error', () => settle(failure('Could not launch Program worker', 503)));
  createInterface({ input: proc.stdout }).on('line', line => {
    if (child !== proc) return;
    let message;
    try { message = JSON.parse(line); } catch { return; }
    if (message.adsReceived) { waitingForAds = false; return; }
    if (message.preview) { frame = message.preview; return; }
    if (!message.status || status.state === 'stopping') return;
    status = { ...status, ...message.status };
    if (status.state === 'running' && pending?.action === 'start') settle();
    else if (message.reply === 'applied') settle();
    else if (message.reply === 'unavailable') settle(failure('OBS media is unavailable'));
  });
  proc.on('close', () => {
    clearInterval(adTimer);
    if (child !== proc) return;
    child = undefined;
    renderer = undefined;
    frame = null;
    clearTimeout(watchdog);
    const stopped = status.state === 'stopping';
    status = { state: stopped ? 'stopped' : 'failed' };
    settle(stopped ? undefined : failure('Program worker exited. Check the media runtime.', 503));
  });
  return result;
}

export function stopProgram() {
  if (!child) return;
  status.state = 'stopping';
  child.stdin.end('stop\n');
  clearTimeout(watchdog);
  watchdog = setTimeout(() => child?.kill(), 3000);
}

export async function programAction(id, action, watermark = { revision: 0, bitmap: '' }, ads) {
  if (!configured(id)) throw failure('Independent Program is not configured for this station');
  if (pending) throw failure('A Program action is pending');
  if (action === 'start') return child ? programStatus(id) : start(watermark, ads);
  if (action === 'stop') {
    if (!child) return programStatus(id);
    const result = waitFor(action);
    stopProgram();
    return result;
  }
  if (status.state !== 'running' || !child) throw failure('Start Program first');
  const result = waitFor(action);
  child.stdin.write(action + '\n');
  return result;
}
