import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { readdir, rmdir, unlink } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { isIPv4 } from 'node:net';
import { networkInterfaces } from 'node:os';
import { z } from 'zod';
import { PROGRAM_CANVAS } from '@mcr/shared';
import { storedWatermark } from './watermark.js';
import { storedTicker } from './ticker.js';
import { createAdRenderer } from './ads.js';
import { receiverHealth } from './receiver-health.js';

const worker = fileURLToPath(new URL('./worker.py', import.meta.url));
const failure = (message, statusCode = 409) => Object.assign(new Error(message), { statusCode });
export const programInputAudioSchema = z.object({
  input: z.enum(['obs', 'obs2']),
  mode: z.enum(['follow', 'on', 'off']),
  gainDb: z.number().int().min(-30).max(0),
}).strict();
let child;
let pending;
let watchdog;
let frame = null;
let inputFrame = null;
let secondInputFrame = null;
let monitorFrame = null;
let hlsDirectory;
const audioListeners = new Set();
const deliveryIssues = new Set();
let deliveryIncidents = [];
let incidentSequence = 0;
let renderer;
let scene;
export const usesLocalSceneAsset = asset => scene?.assets.includes(asset) ?? false;
function scenePicture(settings, first, image) {
  const { width, height } = PROGRAM_CANVAS;
  return {
    video: Buffer.from(first).toString('base64'), image: image ? Buffer.from(image).toString('base64') : '',
    x: Math.round(settings.x * width / 100), y: Math.round(settings.y * height / 100),
    w: Math.round(settings.w * width / 100), h: Math.round(settings.h * height / 100)
  };
}

export function renderLocalScenePreview(settings, first, image) {
  if (status.state !== 'running' || pending) throw failure('Program must be running and ready for preview');
  const result = waitFor('scene-preview');
  pending.previewId = randomUUID();
  child.stdin.write(JSON.stringify({ scenePreview: scenePicture(settings, first, image), previewId: pending.previewId }) + '\n');
  return result;
}

export function takeLocalScene(settings, frames, image, readFrame, pcm, fade = false) {
  if (status.state !== 'running' || pending) throw failure('Program must be running and ready for a take');
  const first = readFrame(0);
  if (!first) throw failure('Scene video is unavailable');
  const result = waitFor('scene');
  scene = { frames, readFrame, start: null, index: 0, waiting: true, assets: [settings.video, settings.image] };
  child.stdin.write(JSON.stringify({ scene: {
    ...scenePicture(settings, first, image),
    fade,
    audio: pcm ? Buffer.from(pcm).toString('base64') : '', audioBytes: frames * 3840 * 4,
  } }) + '\n');
  return result;
}
export function updateAds(plan) { renderer?.update(plan); }
export const previewFrame = () => frame;
export const programMonitorFrame = () => status.state === 'running' &&
  monitorFrame && Date.now() - monitorFrame.at < 2000 ? monitorFrame.image : null;

const hlsFile = /^(?:index\.m3u8|segment\d{5,10}\.ts)$/;
export function programHlsDirectory(id, session, filename) {
  if (configured(id) && status.state === 'running' && status.hls === 'ready' &&
    session === status.session && hlsFile.test(filename)) return hlsDirectory;
  return undefined;
}

async function cleanHls(directory) {
  try {
    const files = await readdir(directory);
    await Promise.allSettled(files.filter(name => hlsFile.test(name)).map(name => unlink(join(directory, name))));
    await rmdir(directory);
  } catch {
    // Leave unknown files or unreachable storage for the host administrator.
  }
}

function setAudioMonitorListening(enabled) {
  if (status.state === 'running' && child?.stdin.writable) {
    child.stdin.write(JSON.stringify({ audioMonitor: enabled }) + '\n');
  }
}

export function listenProgramAudio(id, res) {
  if (!configured(id) || status.state !== 'running' || !status.audioMonitorAvailable) {
    throw failure('Program audio monitor is unavailable', 503);
  }
  if (audioListeners.size >= 8) throw failure('Program audio monitor is at capacity', 429);
  res.set({
    'Content-Type': 'audio/mpeg',
    'Cache-Control': 'private, no-store, no-transform',
    'X-Accel-Buffering': 'no',
  });
  res.once('close', () => {
    audioListeners.delete(res);
    if (!audioListeners.size) setAudioMonitorListening(false);
  });
  audioListeners.add(res);
  if (audioListeners.size === 1) setAudioMonitorListening(true);
  res.flushHeaders();
}

function closeProgramAudio() {
  for (const listener of audioListeners) listener.end();
  audioListeners.clear();
}
export function inputPreviewFrame(input = 'primary') {
  const secondary = input === 'secondary';
  const frame = secondary ? secondInputFrame : inputFrame;
  const health = secondary ? status.obs2 : status.obs;
  return status.state === 'running' && health !== 'disconnected' && frame && Date.now() - frame.at < 2000
    ? frame.image : null;
}
export function updateWatermark(packet) {
  if (child && status.state !== 'stopping') child.stdin.write(JSON.stringify(packet) + '\n');
}
export function updateTicker(ticker) {
  if (child && status.state !== 'stopping') child.stdin.write(JSON.stringify({ ticker }) + '\n');
}
let status = { state: 'stopped' };

export function configured(id) {
  return id === process.env.MCR_PROGRAM_STATION_ID;
}

export function programStatus(id) {
  if (!configured(id)) return { configured: false };
  const result = { configured: true, ...status, deliveryIncidents };
  if (!status.srtDestinations) return result;
  result.srtDestinations = status.srtDestinations.map(destination => {
    const receiver = receiverHealth(destination.id, status.session);
    return receiver ? { ...destination, receiver } : destination;
  });
  return result;
}

function reportDelivery(key, unavailable, ready) {
  let state;
  if (unavailable && !deliveryIssues.has(key)) {
    deliveryIssues.add(key);
    state = 'unavailable';
  } else if (ready && deliveryIssues.delete(key)) {
    state = 'recovered';
  }
  if (state) {
    deliveryIncidents = [...deliveryIncidents.slice(-19), {
      id: ++incidentSequence, destination:key, state, at:new Date().toISOString(),
    }];
  }
}

export function setSourceRecovery(session, recovery) {
  if (status.session === session && status.state === 'running') status = { ...status, sourceRecovery: recovery };
}

function settle(error, data = programStatus(process.env.MCR_PROGRAM_STATION_ID)) {
  if (!pending) return;
  clearTimeout(pending.timer);
  if (error) pending.reject(error);
  else pending.resolve(data);
  pending = undefined;
}

function waitFor(action) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      settle(failure('Program worker timed out', 503));
      if (action !== 'scene-preview') child?.kill();
    }, 15000);
    pending = { action, resolve, reject, timer };
  });
}

function port(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1024 || number > 65535) throw failure('Invalid Program port configuration', 503);
  return number;
}

function srtDestination(id, prefix) {
  const configuredSrt = process.env[prefix + '_URL'];
  const srt = configuredSrt ? URL.parse(configuredSrt) : null;
  if (configuredSrt && (!srt || srt.protocol !== 'srt:' || !srt.hostname || !Number(srt.port) ||
      srt.username || srt.password || srt.hash || (srt.pathname && srt.pathname !== '/') ||
      srt.searchParams.getAll('mode').some(mode => mode !== 'caller'))) {
    throw failure('Program SRT destination must use an explicit host and port in caller mode', 503);
  }
  const passphrase = process.env[prefix + '_PASSPHRASE'];
  if (passphrase) {
    const length = Buffer.byteLength(passphrase);
    if (!srt || length < 10 || length > 79 || passphrase.includes('\0')) {
      throw failure('SRT encryption requires a destination and a 10–79 byte passphrase', 503);
    }
    srt.searchParams.set('passphrase', passphrase);
    srt.searchParams.set('pbkeylen', '32');
  }
  if (!srt) return null;
  // GStreamer defaults to caller mode. Set it explicitly for both slots.
  srt.searchParams.set('mode', 'caller');
  return { id, url: srt.href, encrypted: Boolean(srt.searchParams.get('passphrase')) };
}

function start(watermark, ads, ticker) {
  const blackSeconds = Number(process.env.MCR_PROGRAM_BLACK_SECONDS ?? 0);
  const silenceSeconds = Number(process.env.MCR_PROGRAM_SILENCE_SECONDS ?? 0);
  if (!Number.isInteger(silenceSeconds) || silenceSeconds < 0 || silenceSeconds > 60) {
    throw failure('Silence detection duration must be 0–60 seconds', 503);
  }
  const freezeSeconds = Number(process.env.MCR_PROGRAM_FREEZE_SECONDS ?? 0);
  if (!Number.isInteger(freezeSeconds) || freezeSeconds < 0 || freezeSeconds > 60) {
    throw failure('Freeze detection duration must be 0–60 seconds', 503);
  }
  if (!Number.isInteger(blackSeconds) || blackSeconds < 0 || blackSeconds > 60) {
    throw failure('Black detection duration must be 0–60 seconds', 503);
  }
  const destinations = [
    srtDestination('primary', 'MCR_PROGRAM_SRT'),
    srtDestination('secondary', 'MCR_PROGRAM_SECOND_SRT'),
  ].filter(Boolean);
  const srtDestinations = destinations.map(({ id, encrypted }) => ({ id, encrypted, state: 'connecting' }));
  const primarySrt = srtDestinations.find(({ id }) => id === 'primary');
  const recordingDir = process.env.MCR_PROGRAM_RECORDING_DIR;
  if (recordingDir && !isAbsolute(recordingDir)) throw failure('Program recording directory must be absolute', 503);
  const session = randomUUID();
  const recordingFile = recordingDir ? 'program-' + session + '.ts' : null;
  const configuredUrl = process.env.MCR_PROGRAM_INPUT_URL;
  const inputUrl = configuredUrl ? URL.parse(configuredUrl) : null;
  if (configuredUrl && (!inputUrl || inputUrl.username || inputUrl.password || inputUrl.hash ||
      (inputUrl.protocol !== 'https:' && !(inputUrl.protocol === 'http:' && inputUrl.hostname === '127.0.0.1')))) {
    throw failure('Program input URL must use HTTPS or local test HTTP', 503);
  }
  const input = port(process.env.MCR_PROGRAM_INPUT_PORT || 5100);
  const inputHost = process.env.MCR_PROGRAM_INPUT_HOST || '127.0.0.1';
  if (inputHost !== '127.0.0.1') {
    const [first, second] = inputHost.split('.').map(Number);
    const privateAddress = first === 10 || (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168);
    const assigned = Object.values(networkInterfaces()).flat().some(entry => entry.address === inputHost);
    if (!isIPv4(inputHost) || !privateAddress || !assigned) {
      throw failure('Program input must bind to loopback or an assigned private IPv4 address', 503);
    }
  }
  const output = port(process.env.MCR_PROGRAM_OUTPUT_PORT || 5102);
  const secondPort = process.env.MCR_PROGRAM_SECOND_INPUT_PORT ? port(process.env.MCR_PROGRAM_SECOND_INPUT_PORT) : null;
  if (secondPort === input || secondPort === output) throw failure('Program ports must be distinct', 503);
  const autoBackup = process.env.MCR_PROGRAM_AUTO_BACKUP === '1';
  if (autoBackup && !secondPort) throw failure('Automatic backup requires a second Program input', 503);
  const slate = process.env.MCR_PROGRAM_SLATE || 'bars';
  if (input === output || !['black', 'blue', 'bars'].includes(slate)) throw failure('Invalid Program configuration', 503);
  const env = {};
  for (const key of Object.keys(process.env)) {
    if (/^(path|systemroot|windir|temp|tmp|home|userprofile|localappdata|appdata|lang|ld_library_path|gst_registry|gst_plugin_path)$/i.test(key)) env[key] = process.env[key];
  }
  const hlsRoot = process.env.MCR_PROGRAM_HLS_DIR;
  let directory;
  if (hlsRoot && isAbsolute(hlsRoot)) {
    try { directory = mkdtempSync(join(hlsRoot, 'program-hls-')); }
    catch { /* HLS failure is isolated from the other Program outputs. */ }
  }
  hlsDirectory = directory;
  const proc = spawn(process.env.MCR_PROGRAM_PYTHON || 'python', ['-u', worker, String(input), String(output), slate, inputHost],
    { env, windowsHide: true, stdio: ['pipe', 'pipe', 'inherit'] });
  child = proc;
  renderer = ads;
  let waitingForAds = false;
  const adTimer = setInterval(() => {
    if (status.state !== 'running' || proc.stdin.destroyed || proc.stdin.writableNeedDrain) return;
    if (scene && status.source === 'scene' && !scene.waiting) {
      const index = Math.floor((performance.now() - scene.start) / 80) % scene.frames;
      if (index !== scene.index) {
        const bitmap = scene.readFrame(index);
        scene.index = index;
        scene.waiting = true;
        proc.stdin.write(JSON.stringify({ sceneFrame: bitmap ? Buffer.from(bitmap).toString('base64') : '' }) + '\n');
      }
    }
    if (waitingForAds || proc.stdin.writableNeedDrain) return;
    const packet = ads?.draw(Date.now(), Math.round(performance.timeOrigin + performance.now()));
    if (packet) {
      waitingForAds = true;
      proc.stdin.write(JSON.stringify(packet) + '\n');
    }
  }, 40);
  status = { state: 'starting', session, source: 'fallback', obs: 'disconnected', outputPort: output, recordingFile,
    srt: primarySrt?.state ?? 'disabled', srtEncrypted: primarySrt?.encrypted ?? false,
    srtDestinations, secondPort, autoBackup, hls: directory ? 'starting' : hlsRoot ? 'failed' : 'disabled',
    ...(secondPort ? { secondInputHost: inputHost } : {}),
    ...(inputUrl ? { inputMode: 'url' } : { inputMode: 'udp', inputHost, inputPort: input }) };
  deliveryIncidents = [];
  deliveryIssues.clear();
  reportDelivery('hls', status.hls === 'failed', false);
  const result = waitFor('start');
  proc.stdin.on('error', () => proc.kill());
  proc.stdin.write(JSON.stringify({ canvas: PROGRAM_CANVAS, ...watermark, ticker, inputUrl: inputUrl?.href,
    recordingPath: recordingFile ? join(recordingDir, recordingFile) : null,
    audioMonitor: process.env.MCR_PROGRAM_AUDIO_MONITOR !== '0',
    hlsPath: directory,
    srtDestinations: destinations.map(({ id, url }) => ({ id, url })), blackSeconds, freezeSeconds,
    silenceSeconds, secondPort, autoBackup }) + '\n');
  proc.on('error', () => settle(failure('Could not launch Program worker', 503)));
  createInterface({ input: proc.stdout }).on('line', line => {
    if (child !== proc) return;
    let message;
    try { message = JSON.parse(line); } catch { return; }
    if (Object.hasOwn(message, 'scenePreview')) {
      if (pending?.action === 'scene-preview' && pending.previewId === message.previewId) {
        settle(message.scenePreview ? undefined : failure('Scene media is unreadable'), message.scenePreview);
      }
      return;
    }
    if (message.adsReceived) { waitingForAds = false; return; }
    if (message.sceneReceived && scene) {
      scene.waiting = false;
      scene.start ??= performance.now();
    }
    if (message.preview) { frame = message.preview; return; }
    if (message.programMonitor) { monitorFrame = { image: message.programMonitor, at: Date.now() }; return; }
    if (message.programAudio) {
      if (audioListeners.size) {
        const chunk = Buffer.from(message.programAudio, 'base64');
        for (const listener of audioListeners) {
          if (!listener.destroyed && !listener.write(chunk)) listener.destroy();
        }
      }
      return;
    }
    if (message.inputPreview) { inputFrame = { image: message.inputPreview, at: Date.now() }; return; }
    if (message.input2Preview) { secondInputFrame = { image: message.input2Preview, at: Date.now() }; return; }
    if (message.recordingFinal) { status.recording = message.recordingFinal; return; }
    if (!message.status || status.state === 'stopping') return;
    const { srtStates, ...workerStatus } = message.status;
    status = { ...status, ...workerStatus,
      sceneVideo: workerStatus.source === 'scene' ? scene?.assets[0] : undefined };
    reportDelivery('hls', status.hls === 'failed', status.hls === 'ready');
    if (srtStates) {
      status.srtDestinations = srtDestinations.map(destination => ({
        ...destination, state: srtStates[destination.id] ?? destination.state,
      }));
      status.srt = srtStates.primary ?? 'disabled';
      for (const destination of status.srtDestinations) {
        reportDelivery(destination.id, destination.state === 'retrying', destination.state === 'sending');
      }
    }
    if (status.obs === 'disconnected') inputFrame = null;
    if (status.obs2 === 'disconnected') secondInputFrame = null;
    if (status.source !== 'scene' && (pending?.action !== 'scene' || message.reply === 'sceneUnavailable')) scene = undefined;
    if (status.state === 'running' && pending?.action === 'start') settle();
    else if (message.reply === 'applied') settle();
    else if (message.reply === 'unavailable') settle(failure('Contribution signal is unavailable'));
    else if (message.reply === 'sceneUnavailable' && pending?.action === 'scene') settle(failure('Scene media is unreadable'));
  });
  proc.on('close', () => {
    clearInterval(adTimer);
    if (directory) void cleanHls(directory);
    if (child !== proc) return;
    child = undefined;
    hlsDirectory = undefined;
    closeProgramAudio();
    renderer = undefined;
    scene = undefined;
    frame = null;
    monitorFrame = null;
    inputFrame = null;
    secondInputFrame = null;
    clearTimeout(watchdog);
    const stopped = status.state === 'stopping';
    status = { state: stopped ? 'stopped' : 'failed', recordingFile,
      recording: status.recording === 'recording' ? 'interrupted' : status.recording };
    settle(stopped ? undefined : failure('Program worker exited. Check the media runtime.', 503));
  });
  return result;
}

export function stopProgram() {
  if (!child) return;
  status.state = 'stopping';
  closeProgramAudio();
  child.stdin.end('stop\n');
  clearTimeout(watchdog);
  watchdog = setTimeout(() => child?.kill(), 3000);
}

export async function programAction(id, action, watermark = { revision: 0, bitmap: '' }, ads, audioSetting, ticker) {
  if (!configured(id)) throw failure('Independent Program is not configured for this station');
  if (pending) throw failure('A Program action is pending');
  if (action === 'start') return child ? programStatus(id) : start(watermark, ads, ticker);
  if (action === 'stop') {
    if (!child) return programStatus(id);
    const result = waitFor(action);
    stopProgram();
    return result;
  }
  if (status.state !== 'running' || !child) throw failure('Start Program first');
  let command = action;
  if (action === 'gain') {
    if (!Number.isInteger(audioSetting) || audioSetting < -30 || audioSetting > 0) {
      throw failure('Program gain must be between -30 and 0 dB', 400);
    }
    command = JSON.stringify({ gainDb: audioSetting });
  } else if (action === 'input-audio') {
    const setting = programInputAudioSchema.safeParse(audioSetting);
    if (!setting.success) throw failure('Invalid Program input audio settings', 400);
    if (setting.data.input === 'obs2' && !status.secondPort) throw failure('Second Program input is not configured');
    command = JSON.stringify({ inputAudio: setting.data });
  }
  const result = waitFor(action);
  child.stdin.write(command + '\n');
  return result;
}

export function startConfiguredProgram(id) {
  return programAction(id, 'start', storedWatermark(id), createAdRenderer(id), undefined, storedTicker(id));
}
