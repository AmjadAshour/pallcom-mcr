/** Run explicitly on a local staging host with FFmpeg and the configured worker runtime. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import sharp from 'sharp';
import { inputPreviewFrame, programAction, programStatus } from '../src/infrastructure/program/supervisor.js';

const station = 'isolated-program-fixture';
process.env.MCR_PROGRAM_STATION_ID = station;
process.env.MCR_PROGRAM_SLATE = 'blue';
process.env.MCR_PROGRAM_INPUT_PORT ||= '25100';
process.env.MCR_PROGRAM_OUTPUT_PORT ||= '25102';
const mixFixture = process.env.MCR_TEST_AUDIO_MIX === '1';
if (mixFixture) process.env.MCR_PROGRAM_SECOND_INPUT_PORT = '25104';
const inputHost = process.env.MCR_PROGRAM_INPUT_HOST || '127.0.0.1';
const input = 'udp://' + inputHost + ':' + process.env.MCR_PROGRAM_INPUT_PORT;
const output = 'udp://127.0.0.1:' + process.env.MCR_PROGRAM_OUTPUT_PORT;
const ffmpeg = (args, stdio = 'ignore') => spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...args], { windowsHide: true, stdio });
const decoder = ffmpeg(['-analyzeduration', '300000', '-probesize', '65536', '-i', output,
  '-map', '0:v', '-vf', 'scale=1:1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1',
  '-map', '0:a', '-ac', '1', '-ar', '8000', '-f', 's16le', 'pipe:3'], ['ignore', 'pipe', 'pipe', 'pipe']);
let decoderErrors = '';
decoder.stderr.setEncoding('utf8').on('data', chunk => { decoderErrors = (decoderErrors + chunk).slice(-65536); });
let frames = 0, rgb, remainder = Buffer.alloc(0);
let rms = 0;
let audioChunks = 0;
const mixedTones = { primary: 0, secondary: 0 };
const toneHistory = [];
const toneSampleCount = 800;
let toneSamples = [];
let bufferedByte = Buffer.alloc(0);
function amplitude(sample, frequency) {
  let cosine = 0, sine = 0;
  for (let i = 0; i < sample.length; i++) {
    const angle = i * 2 * Math.PI * frequency / 8000;
    cosine += sample[i] * Math.cos(angle);
    sine += sample[i] * Math.sin(angle);
  }
  return 2 * Math.hypot(cosine, sine) / sample.length;
}
decoder.stdio[3].on('data', chunk => {
  if (mixFixture) {
    const pcm = Buffer.concat([bufferedByte, chunk]);
    const end = pcm.length - pcm.length % 2;
    for (let offset = 0; offset < end; offset += 2) {
      toneSamples.push(pcm.readInt16LE(offset));
      if (toneSamples.length !== toneSampleCount) continue;
      toneHistory.push({ primary:amplitude(toneSamples, 880), secondary:amplitude(toneSamples, 440) });
      if (toneHistory.length > 5) toneHistory.shift();
      for (const key of ['primary', 'secondary']) {
        const sorted = toneHistory.map(reading => reading[key]).sort((a, b) => a - b);
        mixedTones[key] = sorted[Math.floor(sorted.length / 2)];
      }
      toneSamples = [];
    }
    bufferedByte = pcm.subarray(end);
  }
  let sum = 0;
  const count = Math.floor(chunk.length / 2);
  for (let i = 0; i < count; i++) sum += chunk.readInt16LE(i * 2) ** 2;
  if (count) { rms = Math.sqrt(sum / count); audioChunks++; }
});
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
    if (Date.now() - start > timeout) throw Error(label + ' timed out: ' +
      JSON.stringify({ rgb, frames, ...(mixFixture && { mixedTones }), status:programStatus(station) }));
    await sleep(50);
  }
  console.log(label, JSON.stringify({ frames, rgb: [...(rgb || [])], ...programStatus(station) }));
}
const blue = () => rgb && rgb[2] > 180 && rgb[0] < 50;
const red = () => rgb && rgb[0] > 180 && rgb[2] < 50;
const ready = () => programStatus(station).obs === 'ready';
const send = (action, setting) => programAction(station, action, undefined, undefined, setting);
const urlFixture = process.env.MCR_TEST_INPUT_URL === '1';
const blackFixture = process.env.MCR_TEST_BLACK_INPUT === '1';
const freezeFixture = process.env.MCR_TEST_FREEZE_INPUT === '1';
const silenceFixture = process.env.MCR_TEST_SILENT_INPUT === '1';
if (blackFixture) process.env.MCR_PROGRAM_BLACK_SECONDS = '2';
if (freezeFixture) process.env.MCR_PROGRAM_FREEZE_SECONDS = '2';
if (silenceFixture) process.env.MCR_PROGRAM_SILENCE_SECONDS = '2';
let sender;
let secondSender;
let redirects = 0;
let redirectedRequests = 0;
const http = urlFixture && createServer((req, res) => {
  if (req.url === '/redirect-target') {
    redirectedRequests++;
    return res.writeHead(503).end();
  }
  if (!redirects++) return res.writeHead(302, { Location: '/redirect-target' }).end();
  const current = sender;
  if (!current?.stdout || current.exitCode !== null || current.killed) return res.writeHead(503).end();
  res.writeHead(200, { 'Content-Type': 'video/mp2t' });
  current.stdout.pipe(res);
  res.on('close', () => current.stdout.unpipe(res));
});
if (http) {
  http.listen(0, '127.0.0.1');
  await once(http, 'listening');
  process.env.MCR_PROGRAM_INPUT_URL = 'http://127.0.0.1:' + http.address().port + '/fixture?token=private-test';
}
const ordinaryVideo = 'color=red:s=640x360:r=25';
const blackVideo = ordinaryVideo + ',drawbox=x=0:y=0:w=iw:h=ih:color=black:t=fill:enable=between(t\\,8\\,13)';
const motionFilter = ",drawbox=x=0:y=0:w=iw:h=ih:color=maroon:t=fill:enable='lt(mod(t,1.4),0.7)";
const movingVideo = ordinaryVideo + motionFilter + "'";
const freezeVideo = ordinaryVideo + motionFilter + "*not(between(t,9,14))'";
const tone = 'sine=frequency=880:sample_rate=48000';
const contribute = (video = freezeFixture ? movingVideo : ordinaryVideo, sound = tone) => ffmpeg(['-re', '-f', 'lavfi', '-i', video,
  '-f', 'lavfi', '-i', sound, '-c:v', 'libx264',
  '-tune', 'zerolatency', '-g', '25', '-c:a', 'aac', '-f', 'mpegts', http ? 'pipe:1' : input + '?pkt_size=1316'],
  http ? ['ignore', 'pipe', 'ignore'] : 'ignore');
try {
  await assert.rejects(async () => {
    process.env.MCR_PROGRAM_INPUT_HOST = '0.0.0.0';
    try { await send('start'); }
    finally { process.env.MCR_PROGRAM_INPUT_HOST = inputHost; }
  }, /assigned private IPv4/);
  const { session, inputHost: boundHost } = await send('start');
  if (http) {
    assert.equal(programStatus(station).inputMode, 'url');
    assert(!JSON.stringify(programStatus(station)).includes('private-test'));
  } else assert.equal(boundHost, inputHost);
  await until('Cold Program decoded by independent receiver', blue);
  sender = contribute(blackFixture ? blackVideo : freezeFixture ? freezeVideo : ordinaryVideo,
    silenceFixture ? tone + ",volume=0:enable='between(t,9,14)'" : tone);
  await until('Contribution ready', ready);
  await until('Input meter detects test tone', () => Number.isFinite(programStatus(station).inputAudioDbfs) &&
    programStatus(station).inputAudioDbfs > -40 && programStatus(station).inputAudioDbfs < -8);
  assert.equal(programStatus(station).programAudioDbfs, -90);
  await until('Incoming preview ready while receiver stays blue', () => inputPreviewFrame() && blue());
  const preview = Buffer.from(inputPreviewFrame().split(',')[1], 'base64');
  const [r,g,b] = await sharp(preview).resize(1,1).raw().toBuffer();
  assert(r > 180 && g < 80 && b < 50);
  await send('obs');
  await until('Contribution decoded on Program', red);
  await until('Program meter follows the take', () => programStatus(station).programAudioDbfs > -40);
  if (silenceFixture) {
    await until('Connected silent input switched to slate', () => blue() && programStatus(station).obs === 'silent');
    await until('Input meter detects silence', () => Number.isFinite(programStatus(station).inputAudioDbfs) &&
      programStatus(station).inputAudioDbfs <= -60);
    assert(inputPreviewFrame());
    assert.equal(sender.exitCode, null);
    await assert.rejects(send('obs'), /unavailable/);
    await until('Audio recovered but remains off air', () => ready() && blue());
    assert(programStatus(station).inputAudioDbfs > -40);
    await send('obs');
    await until('Manual take after audio recovers decoded', red);
    console.log('Silent input fallback passed');
  }
  if (freezeFixture) {
    await until('Frozen connected input switched to slate', () => blue() && programStatus(station).obs === 'frozen');
    assert(inputPreviewFrame());
    assert.equal(sender.exitCode, null);
    await assert.rejects(send('obs'), /unavailable/);
    await until('Moving source is ready but remains off air', () => ready() && blue());
    await send('obs');
    await until('Manual take after motion returns decoded', red);
    console.log('Frozen input fallback passed');
  }
  if (blackFixture) {
    await until('Continuous black signal switched to slate', () => blue() && programStatus(station).obs === 'black');
    assert(inputPreviewFrame());
    assert.equal(sender.exitCode, null);
    await assert.rejects(send('obs'), /unavailable/);
    await until('Healthy signal remains off air after black', () => ready() && blue());
    await send('obs');
    await until('Manual take after black recovery decoded', red);
    console.log('Black input fallback passed');
  }
  sender.kill();
  await until('Loss replaced by slate', () => blue() && programStatus(station).obs === 'disconnected');
  assert.equal(inputPreviewFrame(), null);
  assert.equal(programStatus(station).inputAudioDbfs, null);
  await until('Program meter returns to slate silence', () => programStatus(station).programAudioDbfs === -90);
  sender = contribute();
  await until('Reconnected input held off air', () => ready() && blue());
  await send('obs');
  await until('Explicit retake decoded', red);
  await until('Receiver audio active before mute', () => rms > 500);
  const audioBeforeMute = audioChunks;
  assert.equal((await send('mute')).programMuted, true);
  await until('Receiver audio muted and contribution still active', () => audioChunks > audioBeforeMute &&
    rms < 5 && red() && programStatus(station).programAudioDbfs === -90 && programStatus(station).inputAudioDbfs > -40);
  assert.equal((await send('unmute')).programMuted, false);
  await until('Receiver audio restored', () => rms > 500 && red() && programStatus(station).programAudioDbfs > -40);
  const baseline = rms;
  await assert.rejects(send('gain', 1), /-30 and 0/);
  assert.equal((await send('gain', -12)).programGainDb, -12);
  await until('Receiver measures roughly 12 dB attenuation', () => red() && rms / baseline > 0.20 &&
    rms / baseline < 0.32 && programStatus(station).programAudioDbfs <= -30);
  assert.equal((await send('gain', 0)).programGainDb, 0);
  await until('Receiver level restored', () => red() && rms / baseline > 0.8 && rms / baseline < 1.2);
  if (mixFixture) {
    secondSender = ffmpeg(['-re', '-f', 'lavfi', '-i', 'color=white:s=640x360:r=25', '-f', 'lavfi',
      '-i', 'sine=frequency=440:sample_rate=48000', '-c:v', 'libx264', '-tune', 'zerolatency',
      '-g', '25', '-c:a', 'aac', '-f', 'mpegts', 'udp://127.0.0.1:25104?pkt_size=1316']);
    await until('Default audio follows the red picture', () => programStatus(station).obs2 === 'ready' &&
      red() && mixedTones.primary > 500 && mixedTones.secondary < 30);
    const route = (input, mode, gainDb = 0) => send('input-audio', { input, mode, gainDb });
    await assert.rejects(route('obs2', 'on', 2), /Invalid Program input audio/);
    assert.equal((await route('obs2', 'on')).inputAudioMix.obs2.routed, true);
    await until('Independent receiver decodes both tones with primary picture', () =>
      red() && mixedTones.primary > 500 && mixedTones.secondary > 500);
    const secondaryReference = mixedTones.secondary;
    await route('obs2', 'on', -12);
    await until('Independent receiver measures secondary attenuation only', () => red() &&
      mixedTones.primary > 500 && mixedTones.secondary / secondaryReference > 0.20 &&
      mixedTones.secondary / secondaryReference < 0.32);
    await route('obs', 'off');
    await until('Muted first input leaves the other tone and the primary picture', () =>
      red() && mixedTones.primary < 30 && mixedTones.secondary > 100);
    await send('mute');
    await until('Master mute silences the mix', () => red() && mixedTones.primary < 30 && mixedTones.secondary < 30);
    await send('unmute');
    await send('fallback');
    await until('Explicitly mixed secondary persists under the slate', () =>
      blue() && mixedTones.primary < 30 && mixedTones.secondary > 100);
    secondSender.kill();
    await until('Lost secondary input is removed from the mix', () => blue() && programStatus(station).obs2 === 'disconnected' &&
      !programStatus(station).inputAudioMix.obs2.routed && mixedTones.secondary < 30);
    console.log('Independent input audio mix passed');
  }
  assert.equal(programStatus(station).session, session);
  assert.doesNotMatch(decoderErrors, /non.monoton|backward in time/i);
  console.log('Program audio timestamp continuity passed');
  console.log('Program mute receiver passed');
  console.log('Program gain receiver passed');
  console.log('Program audio meter passed');
  console.log('Independent input preview and Program take passed');
  if (silenceFixture) console.log('Input audio meter passed');
  if (inputHost !== '127.0.0.1') console.log('Private-interface contribution passed');
  if (http) {
    assert(redirects > 1);
    assert.equal(redirectedRequests, 0);
    console.log('Configured URL contribution passed');
  }
} finally {
  sender?.kill();
  secondSender?.kill();
  decoder.kill();
  await send('stop');
  http?.close?.();
}
