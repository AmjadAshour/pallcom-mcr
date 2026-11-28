import { execFile } from 'node:child_process';
import { lookup } from 'node:dns/promises';
import { isIPv4 } from 'node:net';
import { promisify } from 'node:util';
import {
  AUDIO_SOURCE_STATES,
  MEDIA_PROCESSING_STATUS
} from '@mcr/shared';
import { env } from '../../config/env.js';
import { agentGateway } from '../agent/agent-gateway.js';
import { mediaStorage } from '../media/storage-manager.js';
import { isPublicIPv4, isPublicSourceHostname } from '../program/input-config.js';
import { pushExternalAudioFrame } from '../program/supervisor.js';
import { RepositoryFactory } from '../repositories/repository-factory.js';
import { CryptoService } from '../security/crypto-service.js';
import { computeReconnectBackoffMs } from '../sources/video-source-service.js';

const runFile = promisify(execFile);

export const SAMPLE_RATE = 48000;
export const CHANNELS = 2;
export const FRAME_DURATION_MS = 20;
export const SAMPLES_PER_FRAME_PER_CHANNEL = 960; // 48000 * 0.020
export const INT16_SAMPLES_PER_FRAME = SAMPLES_PER_FRAME_PER_CHANNEL * CHANNELS; // 1920
export const BYTES_PER_FRAME = INT16_SAMPLES_PER_FRAME * 2; // 3840 bytes

function childEnvironment() {
  return Object.fromEntries(
    Object.entries(process.env).filter(([name]) =>
      /^(path|systemroot|windir|temp|tmp|lang|ld_library_path)$/i.test(name)
    )
  );
}

export function dbToLinear(db) {
  if (!Number.isFinite(db) || db <= -90) return 0;
  return 10 ** (db / 20);
}

export function linearToDbfs(linearAmplitude) {
  if (!Number.isFinite(linearAmplitude) || linearAmplitude <= 1e-5) return -90.0;
  return Number(Math.max(-90.0, Math.min(6.0, 20 * Math.log10(linearAmplitude))).toFixed(2));
}

export function measurePcmFrame(pcmBuffer) {
  if (!pcmBuffer || pcmBuffer.length < 2) {
    return { rmsDbfs: -90.0, peakDbfs: -90.0, rmsLinear: 0, peakLinear: 0 };
  }
  const sampleCount = Math.floor(pcmBuffer.length / 2);
  let sumSquares = 0;
  let maxAbs = 0;
  for (let i = 0; i < sampleCount; i++) {
    const val = Math.abs(pcmBuffer.readInt16LE(i * 2)) / 32768.0;
    sumSquares += val * val;
    if (val > maxAbs) maxAbs = val;
  }
  const rmsLinear = Math.sqrt(sumSquares / sampleCount);
  return {
    rmsLinear,
    peakLinear: maxAbs,
    rmsDbfs: linearToDbfs(rmsLinear),
    peakDbfs: linearToDbfs(maxAbs)
  };
}

export function generateTonePcm(frequencyHz, durationMs, amplitudeLinear = 0.5, sampleRate = SAMPLE_RATE) {
  const totalSamplesPerChannel = Math.round((sampleRate * durationMs) / 1000);
  const buffer = Buffer.alloc(totalSamplesPerChannel * CHANNELS * 2);
  const clampedAmp = Math.max(0, Math.min(1.0, amplitudeLinear));
  for (let i = 0; i < totalSamplesPerChannel; i++) {
    const sample = Math.round(Math.sin((2 * Math.PI * frequencyHz * i) / sampleRate) * clampedAmp * 32767);
    const offset = i * 4;
    buffer.writeInt16LE(sample, offset);
    buffer.writeInt16LE(sample, offset + 2);
  }
  return buffer;
}

export async function decodeMediaFileToPcm(filePath, maxSeconds = 60) {
  const ffmpegBin = process.env.FFMPEG_PATH || 'ffmpeg';
  const { stdout } = await runFile(
    ffmpegBin,
    [
      '-nostdin',
      '-v', 'error',
      '-threads', '1',
      '-t', String(maxSeconds),
      '-i', filePath,
      '-vn',
      '-ac', String(CHANNELS),
      '-ar', String(SAMPLE_RATE),
      '-f', 's16le',
      'pipe:1'
    ],
    {
      env: childEnvironment(),
      windowsHide: true,
      encoding: 'buffer',
      timeout: Math.min(30000, env.MEDIA_PROCESSING_TIMEOUT_MS),
      maxBuffer: Math.ceil(maxSeconds * SAMPLE_RATE * CHANNELS * 2 + 1024 * 1024)
    }
  );
  return stdout;
}

export async function validateRadioStreamUrl(rawUrl, resolveIPv4 = null) {
  if (!rawUrl || typeof rawUrl !== 'string') {
    throw Object.assign(new Error('Radio stream URL is required'), { statusCode: 400 });
  }
  const parsed = URL.parse(rawUrl.trim());
  if (!parsed || !parsed.hostname || !['https:', 'http:'].includes(parsed.protocol)) {
    throw Object.assign(new Error('Internet radio stream requires a valid HTTP or HTTPS URL'), { statusCode: 400 });
  }
  if (parsed.username || parsed.password || parsed.hash) {
    throw Object.assign(
      new Error('Do not embed credentials or fragments in the radio URL; use the dedicated encrypted secret field'),
      { statusCode: 400 }
    );
  }

  const allowLoopbackFixture = process.env.MCR_ALLOW_LOOPBACK_AUDIO_SOURCE_FOR_TESTS === '1' &&
    process.env.NODE_ENV !== 'production' &&
    parsed.hostname === '127.0.0.1';

  if (!allowLoopbackFixture) {
    if (!isPublicSourceHostname(parsed.hostname)) {
      throw Object.assign(new Error('Radio stream hostname is not a permitted public destination'), { statusCode: 400 });
    }
    if (isIPv4(parsed.hostname)) {
      if (!isPublicIPv4(parsed.hostname)) {
        throw Object.assign(new Error('Radio stream IPv4 address is not a permitted public destination'), { statusCode: 400 });
      }
    } else {
      const resolver = resolveIPv4 || (async host => {
        const records = await lookup(host, { family: 4, all: true, verbatim: true });
        return records.map(r => r.address);
      });
      const addresses = await resolver(parsed.hostname).catch(() => []);
      if (!addresses.length || !addresses.every(addr => isPublicIPv4(addr))) {
        throw Object.assign(new Error('Radio stream hostname resolved to a private or non-public IPv4 address'), { statusCode: 400 });
      }
    }
  }
  return parsed.href;
}

export async function probeRadioStream(url) {
  const ffprobeBin = process.env.FFPROBE_PATH || 'ffprobe';
  const { stdout } = await runFile(
    ffprobeBin,
    [
      '-v', 'error',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      url
    ],
    {
      env: childEnvironment(),
      windowsHide: true,
      timeout: 12000,
      maxBuffer: 1024 * 1024
    }
  );
  const parsed = JSON.parse(stdout);
  const streams = Array.isArray(parsed?.streams) ? parsed.streams : [];
  const audio = streams.find(s => s.codec_type === 'audio');
  if (!audio) throw new Error('Stream does not contain a decodable audio track');
  const tags = { ...(parsed?.format?.tags || {}), ...(audio?.tags || {}) };
  const titleMeta = tags.StreamTitle || tags['icy-name'] || tags.title || null;
  return {
    codec: audio.codec_name?.toLowerCase() || 'mp3',
    sampleRateHz: audio.sample_rate ? Number(audio.sample_rate) : 48000,
    channels: audio.channels ? Number(audio.channels) : 2,
    streamMetadata: titleMeta ? String(titleMeta).slice(0, 300) : null
  };
}

/**
 * Pure DSP multi-track mixer step for one 20ms frame (3840 bytes stereo S16LE).
 * Supports per-source linear volume + dB gain, mute, priority-based ducking with attack/hold/release envelope,
 * equal-power or linear crossfade weights, advertisement audio policies, and soft-knee peak limiting.
 */
export function mixPcmFrameDsp({
  sources,
  mixerConfig,
  duckingEnvelopeState = { currentReductionDb: 0, holdRemainingMs: 0 },
  monitoringSoloOnly = false
}) {
  const frameBytes = BYTES_PER_FRAME;
  const floatSamples = new Float64Array(INT16_SAMPLES_PER_CHANNEL_STEREO);

  const soloActive = monitoringSoloOnly && sources.some(s => s.enabled && s.soloMonitoring);

  // 1. Evaluate whether any ducking trigger source (e.g. active microphone or ad or high-priority trigger) is speaking above threshold
  let triggerActive = false;
  let highestTriggerPriority = -Infinity;

  for (const src of sources) {
    if (!src.enabled || src.muted || !src.pcmFrame || src.pcmFrame.length < frameBytes) continue;
    const isAdSource = src.sourceType === 'ADVERTISEMENT_AUDIO';
    const isMicSource = src.sourceType === 'MICROPHONE_INPUT';
    if (src.duckingTrigger || isMicSource || (isAdSource && mixerConfig.adActive)) {
      const m = measurePcmFrame(src.pcmFrame);
      src.measuredRmsDbfs = m.rmsDbfs;
      src.measuredPeakDbfs = m.peakDbfs;
      if (m.rmsDbfs >= (mixerConfig.duckingThresholdDbfs ?? -32.0)) {
        triggerActive = true;
        if ((src.priority ?? 50) > highestTriggerPriority) {
          highestTriggerPriority = src.priority ?? 50;
        }
      }
    }
  }

  // 2. Update smooth ducking envelope (Attack / Hold / Release) without abrupt jumps
  const targetReductionDb = (mixerConfig.duckingEnabled && triggerActive)
    ? Math.min(0, Number(mixerConfig.duckingReductionDb ?? -12.0))
    : 0.0;

  let currentReductionDb = Number(duckingEnvelopeState.currentReductionDb ?? 0);
  let holdRemainingMs = Number(duckingEnvelopeState.holdRemainingMs ?? 0);

  if (triggerActive) {
    holdRemainingMs = Number(mixerConfig.duckingHoldMs ?? 300);
    const attackFrames = Math.max(1, Math.round((mixerConfig.duckingAttackMs ?? 120) / FRAME_DURATION_MS));
    const stepDb = Math.abs(targetReductionDb) / attackFrames;
    currentReductionDb = Math.max(targetReductionDb, currentReductionDb - stepDb);
  } else if (holdRemainingMs > 0) {
    holdRemainingMs = Math.max(0, holdRemainingMs - FRAME_DURATION_MS);
  } else if (currentReductionDb < 0) {
    const releaseFrames = Math.max(1, Math.round((mixerConfig.duckingReleaseMs ?? 600) / FRAME_DURATION_MS));
    const stepDb = Math.abs(Number(mixerConfig.duckingReductionDb ?? -12.0)) / releaseFrames;
    currentReductionDb = Math.min(0, currentReductionDb + stepDb);
  }

  duckingEnvelopeState.currentReductionDb = currentReductionDb;
  duckingEnvelopeState.holdRemainingMs = holdRemainingMs;

  const duckingGainMultiplier = dbToLinear(currentReductionDb);

  // 3. Determine advertisement audio policy suppression
  const adPlaying = Boolean(mixerConfig.adActive) &&
    sources.some(s => s.enabled && !s.muted && s.sourceType === 'ADVERTISEMENT_AUDIO' && s.pcmFrame);
  const replaceMusicForAd = adPlaying && [
    'REPLACE_MUSIC_PAUSE_PLAYLIST',
    'REPLACE_MUSIC_CONTINUE_PLAYLIST'
  ].includes(mixerConfig.adAudioPolicy);
  const duckMusicForAd = adPlaying && mixerConfig.adAudioPolicy === 'DUCK_MUSIC_DURING_ADS';

  // 4. Mix active sources into float accumulator
  for (const src of sources) {
    if (!src.enabled || !src.pcmFrame || src.pcmFrame.length < frameBytes) {
      src.measuredRmsDbfs = -90.0;
      src.measuredPeakDbfs = -90.0;
      continue;
    }

    const metrics = measurePcmFrame(src.pcmFrame);
    src.measuredRmsDbfs = metrics.rmsDbfs;
    src.measuredPeakDbfs = metrics.peakDbfs;

    if (src.muted) continue;
    if (soloActive && !src.soloMonitoring) continue;

    if (src.sourceType === 'ADVERTISEMENT_AUDIO' && mixerConfig.adAudioPolicy === 'IGNORE_AD_AUDIO') {
      continue;
    }

    const isBackgroundMusicOrRadio = [
      'UPLOADED_AUDIO',
      'MUSIC_PLAYLIST',
      'INTERNET_RADIO',
      'ICECAST_STREAM',
      'SHOUTCAST_STREAM',
      'FALLBACK_AUDIO'
    ].includes(src.sourceType);

    if (replaceMusicForAd && isBackgroundMusicOrRadio) {
      continue;
    }

    if (src.sourceType === 'VIDEO_EXTRACTED_AUDIO' || src.sourceType === 'OBS_AUDIO_INPUT') {
      if (mixerConfig.routingMode === 'EXTERNAL_REPLACES_VIDEO_AUDIO' ||
          mixerConfig.routingMode === 'SILENT_VIDEO_WITH_INDEPENDENT_AUDIO' ||
          mixerConfig.cameraAudioMuted) {
        continue;
      }
    }

    if (isBackgroundMusicOrRadio && mixerConfig.routingMode === 'ORIGINAL_VIDEO_AUDIO_ONLY') {
      continue;
    }

    let gain = Math.max(0, Number(src.volumeLinear ?? 1.0)) * dbToLinear(Number(src.gainDb ?? 0.0));
    if (src.crossfadeWeight !== undefined) {
      gain *= Math.max(0, Math.min(1, Number(src.crossfadeWeight)));
    }
    if (src.fadeEnvelopeWeight !== undefined) {
      gain *= Math.max(0, Math.min(1, Number(src.fadeEnvelopeWeight)));
    }

    // Apply ducking if target and lower priority than active trigger (or during ad duck policy)
    const shouldDuck = (src.duckingTarget && currentReductionDb < 0 && (src.priority ?? 50) < highestTriggerPriority) ||
      (duckMusicForAd && isBackgroundMusicOrRadio);
    if (shouldDuck) {
      const adDuckLinear = duckMusicForAd ? dbToLinear(Number(mixerConfig.duckingReductionDb ?? -12.0)) : 1.0;
      gain *= Math.min(duckingGainMultiplier, adDuckLinear);
    }

    for (let i = 0; i < INT16_SAMPLES_PER_CHANNEL_STEREO; i++) {
      const sample = src.pcmFrame.readInt16LE(i * 2) / 32768.0;
      floatSamples[i] += sample * gain;
    }
  }

  // 5. Apply master volume, master gain, master mute, and peak limiter / clipping prevention
  const masterMuted = Boolean(mixerConfig.masterMuted);
  const masterGain = masterMuted
    ? 0
    : Math.max(0, Number(mixerConfig.masterVolumeLinear ?? 1.0)) * dbToLinear(Number(mixerConfig.masterGainDb ?? 0.0));

  const ceilingLinear = Math.min(0.999, dbToLinear(Number(mixerConfig.peakLimiterCeilingDbfs ?? -1.0)));
  const outputBuffer = Buffer.alloc(frameBytes);
  let clippingPrevented = false;

  if (masterGain > 0) {
    for (let i = 0; i < INT16_SAMPLES_PER_CHANNEL_STEREO; i++) {
      let val = floatSamples[i] * masterGain;
      const absVal = Math.abs(val);
      if (absVal > ceilingLinear) {
        clippingPrevented = true;
        // Soft-knee saturation limiting strictly bounded at ceilingLinear
        const sign = val >= 0 ? 1 : -1;
        const excess = absVal - ceilingLinear;
        const headroom = Math.max(0.01, 1.0 - ceilingLinear);
        val = sign * Math.min(ceilingLinear, ceilingLinear * (1 - 0.05 * Math.exp(-excess / headroom)));
      }
      const intSample = Math.max(-32768, Math.min(32767, Math.round(val * 32767)));
      outputBuffer.writeInt16LE(intSample, i * 2);
    }
  }

  const masterMetrics = measurePcmFrame(outputBuffer);
  return {
    pcmBuffer: outputBuffer,
    masterRmsDbfs: masterMetrics.rmsDbfs,
    masterPeakDbfs: masterMetrics.peakDbfs,
    masterRmsLinear: masterMetrics.rmsLinear,
    masterPeakLinear: masterMetrics.peakLinear,
    clippingPrevented,
    duckingReductionAppliedDb: Number(currentReductionDb.toFixed(2))
  };
}

const INT16_SAMPLES_PER_CHANNEL_STEREO = INT16_SAMPLES_PER_FRAME;

/**
 * Computes linear or equal-power crossfade between an outgoing PCM buffer and an incoming PCM buffer.
 */
export function crossfadePcmBuffers(outgoingPcm, incomingPcm, crossfadeDurationMs = 1500) {
  const crossfadeSamplesPerChannel = Math.max(
    1,
    Math.min(
      Math.floor(outgoingPcm.length / 4),
      Math.floor(incomingPcm.length / 4),
      Math.round((SAMPLE_RATE * crossfadeDurationMs) / 1000)
    )
  );
  const crossfadeBytes = crossfadeSamplesPerChannel * 4;
  const prefix = outgoingPcm.subarray(0, outgoingPcm.length - crossfadeBytes);
  const suffix = incomingPcm.subarray(crossfadeBytes);
  const overlap = Buffer.alloc(crossfadeBytes);

  for (let i = 0; i < crossfadeSamplesPerChannel; i++) {
    const t = i / crossfadeSamplesPerChannel;
    // Equal-power sin/cos crossfade curve that prevents both energy dips and clipping
    const weightOut = Math.cos(t * 0.5 * Math.PI);
    const weightIn = Math.sin(t * 0.5 * Math.PI);
    for (let ch = 0; ch < 2; ch++) {
      const byteOffset = i * 4 + ch * 2;
      const outSample = outgoingPcm.readInt16LE(prefix.length + byteOffset);
      const inSample = incomingPcm.readInt16LE(byteOffset);
      const mixed = Math.max(-32768, Math.min(32767, Math.round(outSample * weightOut + inSample * weightIn)));
      overlap.writeInt16LE(mixed, byteOffset);
    }
  }

  return Buffer.concat([prefix, overlap, suffix]);
}

/**
 * Per-Channel Independent Audio Runtime Context.
 * Each channel (e.g. Channel 1, Channel 2, or dynamically provisioned channels) gets its own isolated engine.
 */
export class ChannelAudioEngine {
  constructor(channelId, organizationId) {
    this.channelId = channelId;
    this.organizationId = organizationId;
    this.sourceBuffers = new Map(); // sourceId -> { pcm: Buffer, cursorBytes: number, tracks: Array, trackIndex: number }
    this.micSessions = new Map(); // sourceId -> { active: boolean, userId: string, sessionId: string, expiresAt: number, ptt: boolean, queue: Buffer[] }
    this.duckingEnvelope = { currentReductionDb: 0, holdRemainingMs: 0 };
    this.monitorListeners = new Set();
    this.broadcastListeners = new Set();
    this.tickTimer = null;
    this.frameCounter = 0;
    this.videoSwitchEvents = [];
    this.activeCrossfade = null; // { fromSourceId, toSourceId, totalFrames, elapsedFrames }
  }

  startCrossfade(fromSourceId, toSourceId, durationMs = 500) {
    if (!fromSourceId || !toSourceId || fromSourceId === toSourceId) return;
    const totalFrames = Math.max(1, Math.round(Number(durationMs || 500) / FRAME_DURATION_MS));
    this.activeCrossfade = { fromSourceId, toSourceId, totalFrames, elapsedFrames: 0 };
  }

  loadSourcePcm(sourceId, pcmBuffer, metadata = {}) {
    this.sourceBuffers.set(sourceId, {
      pcm: pcmBuffer,
      cursorBytes: 0,
      ...metadata
    });
  }

  activateMicrophone(sourceId, { userId, sessionId, expiresAt, pushToTalk = false }) {
    this.micSessions.set(sourceId, {
      active: true,
      userId,
      sessionId,
      expiresAt,
      pushToTalk,
      queue: []
    });
  }

  deactivateMicrophone(sourceId) {
    this.micSessions.delete(sourceId);
  }

  pushMicrophonePcm(sourceId, pcmChunk, { userId, sessionId }) {
    const mic = this.micSessions.get(sourceId);
    if (!mic || !mic.active) {
      throw Object.assign(new Error('Microphone is not explicitly activated for this channel'), { statusCode: 409 });
    }
    if (mic.userId !== userId || mic.sessionId !== sessionId || Date.now() >= mic.expiresAt) {
      this.micSessions.delete(sourceId);
      throw Object.assign(new Error('Microphone session expired or unauthorized'), { statusCode: 401 });
    }
    for (let offset = 0; offset < pcmChunk.length; offset += BYTES_PER_FRAME) {
      const slice = pcmChunk.subarray(offset, offset + BYTES_PER_FRAME);
      const frame = slice.length === BYTES_PER_FRAME
        ? Buffer.from(slice)
        : Buffer.concat([slice, Buffer.alloc(BYTES_PER_FRAME - slice.length)]);
      if (mic.queue.length < 50) mic.queue.push(frame);
    }
  }

  recordVideoSwitch(fromVideoSource, toVideoSource) {
    this.videoSwitchEvents.push({
      atFrame: this.frameCounter,
      atTimestampMs: this.frameCounter * FRAME_DURATION_MS,
      fromVideoSource,
      toVideoSource
    });
  }

  _nextFrameForSource(src) {
    if (!src.enabled || src.state === AUDIO_SOURCE_STATES.DISABLED || src.state === AUDIO_SOURCE_STATES.ERROR) {
      return null;
    }
    if (src.sourceType === 'GENERATED_SILENCE') {
      return Buffer.alloc(BYTES_PER_FRAME);
    }
    if (src.sourceType === 'MICROPHONE_INPUT') {
      const mic = this.micSessions.get(src.id);
      if (!mic || !mic.active || Date.now() >= mic.expiresAt) {
        if (mic && Date.now() >= mic.expiresAt) this.micSessions.delete(src.id);
        return null;
      }
      return mic.queue.shift() || Buffer.alloc(BYTES_PER_FRAME);
    }

    const loaded = this.sourceBuffers.get(src.id);
    if (!loaded || !loaded.pcm || loaded.pcm.length < BYTES_PER_FRAME) {
      return null;
    }

    const end = loaded.cursorBytes + BYTES_PER_FRAME;
    let frame;
    if (end <= loaded.pcm.length) {
      frame = loaded.pcm.subarray(loaded.cursorBytes, end);
      loaded.cursorBytes = end === loaded.pcm.length ? 0 : end;
    } else {
      const tail = loaded.pcm.subarray(loaded.cursorBytes);
      const head = loaded.pcm.subarray(0, BYTES_PER_FRAME - tail.length);
      frame = Buffer.concat([tail, head]);
      loaded.cursorBytes = head.length;
    }
    return frame;
  }

  async stepFrame({ persistMeters = false } = {}) {
    const audioRepo = RepositoryFactory.getAudioRepository();
    const [sources, mixerConfig] = await Promise.all([
      audioRepo.listAudioSources(this.organizationId, { channelId: this.channelId }),
      audioRepo.getChannelMixerConfig(this.channelId, this.organizationId)
    ]);

    const preparedSources = sources.map(src => {
      const cf = this.activeCrossfade;
      const inCrossfade = Boolean(cf && (src.id === cf.fromSourceId || src.id === cf.toSourceId));
      const effectiveSrc = inCrossfade ? { ...src, enabled: true } : src;
      let crossfadeWeight;
      if (inCrossfade) {
        const t = Math.min(1, cf.elapsedFrames / cf.totalFrames);
        crossfadeWeight = src.id === cf.fromSourceId ? Math.cos(t * 0.5 * Math.PI) : Math.sin(t * 0.5 * Math.PI);
      }
      return {
        ...effectiveSrc,
        ...(crossfadeWeight !== undefined ? { crossfadeWeight } : {}),
        pcmFrame: this._nextFrameForSource(effectiveSrc)
      };
    });
    if (this.activeCrossfade) {
      this.activeCrossfade.elapsedFrames += 1;
      if (this.activeCrossfade.elapsedFrames >= this.activeCrossfade.totalFrames) {
        this.activeCrossfade = null;
      }
    }

    // Check if primary music/radio sources have no signal and activate fallback source if configured
    const hasPrimarySignal = preparedSources.some(
      s => s.enabled && !s.muted && s.sourceType !== 'FALLBACK_AUDIO' && s.pcmFrame &&
        measurePcmFrame(s.pcmFrame).rmsDbfs > (mixerConfig.silenceThresholdDbfs ?? -60.0)
    );

    const activeSources = preparedSources.map(s => {
      if (s.sourceType === 'FALLBACK_AUDIO') {
        return { ...s, enabled: s.enabled && !hasPrimarySignal };
      }
      return s;
    });

    const broadcastMix = mixPcmFrameDsp({
      sources: activeSources,
      mixerConfig,
      duckingEnvelopeState: this.duckingEnvelope,
      monitoringSoloOnly: false
    });

    const monitorMix = mixPcmFrameDsp({
      sources: activeSources,
      mixerConfig,
      duckingEnvelopeState: { ...this.duckingEnvelope },
      monitoringSoloOnly: true
    });

    this.frameCounter++;

    // Forward mixed PCM to the GStreamer Program worker when running on this station/channel
    const workerMode = [
      'EXTERNAL_REPLACES_VIDEO_AUDIO',
      'SILENT_VIDEO_WITH_INDEPENDENT_AUDIO'
    ].includes(mixerConfig.routingMode)
      ? 'replace'
      : mixerConfig.routingMode === 'ORIGINAL_VIDEO_AUDIO_ONLY'
        ? 'off'
        : 'mix';
    pushExternalAudioFrame(this.channelId, broadcastMix.pcmBuffer, workerMode);

    if (persistMeters) {
      await audioRepo.saveChannelMixerConfig(this.channelId, this.organizationId, {
        measuredMasterRmsDbfs: broadcastMix.masterRmsDbfs,
        measuredMasterPeakDbfs: broadcastMix.masterPeakDbfs,
        masterClippingPrevented: broadcastMix.clippingPrevented
      });
      for (const s of activeSources) {
        await audioRepo.updateAudioSourceRuntimeState(s.id, this.organizationId, {
          measuredRmsDbfs: s.measuredRmsDbfs,
          measuredPeakDbfs: s.measuredPeakDbfs
        });
      }
    }

    return {
      frameIndex: this.frameCounter,
      ptsMs: (this.frameCounter - 1) * FRAME_DURATION_MS,
      broadcastMix,
      monitorMix,
      sources: activeSources.map(s => ({
        id: s.id,
        name: s.name,
        sourceType: s.sourceType,
        measuredRmsDbfs: s.measuredRmsDbfs,
        measuredPeakDbfs: s.measuredPeakDbfs
      }))
    };
  }
}

class MultiChannelAudioManager {
  constructor() {
    this.engines = new Map(); // `${organizationId}:${channelId}` -> ChannelAudioEngine
  }

  getEngine(channelId, organizationId) {
    const key = `${organizationId}:${channelId}`;
    let engine = this.engines.get(key);
    if (!engine) {
      engine = new ChannelAudioEngine(channelId, organizationId);
      this.engines.set(key, engine);
    }
    return engine;
  }

  removeEngine(channelId, organizationId) {
    const key = `${organizationId}:${channelId}`;
    this.engines.delete(key);
  }
}

export const multiChannelAudio = new MultiChannelAudioManager();

export async function validateAndPrepareAudioSourceInput(organizationId, channelId, input) {
  const stationRepo = RepositoryFactory.getStationRepository();
  const mediaRepo = RepositoryFactory.getMediaRepository();
  const videoSourceRepo = RepositoryFactory.getVideoSourceRepository();

  const station = await stationRepo.findById(channelId, organizationId);
  if (!station) {
    throw Object.assign(new Error('Target channel / station not found in organization'), { statusCode: 404 });
  }

  const {
    sourceType,
    mediaAssetId = null,
    playlistId = null,
    videoSourceId = null,
    obsInputName = null,
    streamUrl = null,
    secret = null
  } = input;

  let normalizedUrl = null;
  let encryptedSecret = null;
  let initialTrackAssetId = null;
  let codec = 'aac';
  let sampleRateHz = 48000;
  let channels = 2;
  let state = input.enabled === false ? AUDIO_SOURCE_STATES.DISABLED : AUDIO_SOURCE_STATES.ONLINE;

  if (secret && typeof secret === 'string' && secret.trim()) {
    encryptedSecret = CryptoService.encryptSecret(secret.trim());
  }

  if (['UPLOADED_AUDIO', 'ADVERTISEMENT_AUDIO', 'FALLBACK_AUDIO'].includes(sourceType)) {
    if (!mediaAssetId) {
      throw Object.assign(new Error(`${sourceType} requires a validated mediaAssetId`), { statusCode: 400 });
    }
    const asset = await mediaRepo.findAssetById(mediaAssetId, organizationId);
    if (!asset) throw Object.assign(new Error('Audio media asset not found'), { statusCode: 404 });
    if (asset.processingStatus !== MEDIA_PROCESSING_STATUS.READY || !asset.hasAudio) {
      throw Object.assign(new Error('Media asset must be READY and contain an audio stream'), { statusCode: 409 });
    }
    codec = asset.audioCodec || 'aac';
    sampleRateHz = asset.sampleRateHz || 48000;
    channels = asset.audioChannels || 2;
    initialTrackAssetId = asset.id;

    // Decode initial PCM buffer into the channel's audio engine for immediate playback
    try {
      const filePath = mediaStorage.resolveKeyPath(asset.storageKey);
      const pcm = await decodeMediaFileToPcm(filePath, 30);
      if (pcm?.length) {
        return {
          normalizedUrl,
          encryptedSecret,
          initialTrackAssetId,
          codec,
          sampleRateHz,
          channels,
          state: state === AUDIO_SOURCE_STATES.DISABLED ? state : AUDIO_SOURCE_STATES.PLAYING,
          decodedPcm: pcm
        };
      }
    } catch {
      // keep ONLINE
    }
  } else if (sourceType === 'MUSIC_PLAYLIST') {
    if (!playlistId) {
      throw Object.assign(new Error('MUSIC_PLAYLIST requires a playlistId'), { statusCode: 400 });
    }
    const playlists = await mediaRepo.listPlaylists(organizationId);
    const playlist = playlists.find(p => p.id === playlistId);
    if (!playlist || !playlist.items?.length) {
      throw Object.assign(new Error('Audio playlist not found or empty'), { statusCode: 404 });
    }
    const firstItem = playlist.items[0];
    const firstAsset = await mediaRepo.findAssetById(firstItem.assetId, organizationId);
    if (!firstAsset || firstAsset.processingStatus !== MEDIA_PROCESSING_STATUS.READY || !firstAsset.hasAudio) {
      throw Object.assign(new Error('Playlist first track is unavailable or lacks audio'), { statusCode: 409 });
    }
    initialTrackAssetId = firstAsset.id;
    codec = firstAsset.audioCodec || 'mp3';
    sampleRateHz = firstAsset.sampleRateHz || 48000;
    channels = firstAsset.audioChannels || 2;
    state = state === AUDIO_SOURCE_STATES.DISABLED ? state : AUDIO_SOURCE_STATES.PLAYING;
  } else if (['INTERNET_RADIO', 'ICECAST_STREAM', 'SHOUTCAST_STREAM'].includes(sourceType)) {
    normalizedUrl = await validateRadioStreamUrl(streamUrl);
  } else if (sourceType === 'MICROPHONE_INPUT') {
    // Microphone must never broadcast automatically without explicit activation
    state = AUDIO_SOURCE_STATES.PAUSED;
    codec = 'pcm_s16le';
  } else if (sourceType === 'VIDEO_EXTRACTED_AUDIO') {
    if (!videoSourceId) {
      throw Object.assign(new Error('VIDEO_EXTRACTED_AUDIO requires a videoSourceId'), { statusCode: 400 });
    }
    const vSource = await videoSourceRepo.findSourceById(videoSourceId, organizationId);
    if (!vSource) throw Object.assign(new Error('Linked video source not found'), { statusCode: 404 });
    codec = vSource.audioCodec || 'aac';
  } else if (sourceType === 'OBS_AUDIO_INPUT') {
    if (!obsInputName || !obsInputName.trim()) {
      throw Object.assign(new Error('OBS_AUDIO_INPUT requires an obsInputName'), { statusCode: 400 });
    }
    const connected = agentGateway.isAgentOnline(channelId) || station.status === 'ONLINE';
    state = connected ? AUDIO_SOURCE_STATES.ONLINE : AUDIO_SOURCE_STATES.UNAVAILABLE;
  } else if (sourceType === 'GENERATED_SILENCE') {
    codec = 'pcm_s16le';
    state = AUDIO_SOURCE_STATES.ONLINE;
  }

  return {
    normalizedUrl,
    encryptedSecret,
    initialTrackAssetId,
    codec,
    sampleRateHz,
    channels,
    state
  };
}

export async function probeAudioSourceHealth(id, organizationId) {
  const audioRepo = RepositoryFactory.getAudioRepository();
  const mediaRepo = RepositoryFactory.getMediaRepository();
  const source = await audioRepo.findAudioSourceById(id, organizationId, { includeEncryptedSecret: true });
  if (!source) return null;

  try {
    if (['INTERNET_RADIO', 'ICECAST_STREAM', 'SHOUTCAST_STREAM'].includes(source.sourceType)) {
      const validatedUrl = await validateRadioStreamUrl(source.streamUrl);
      const probed = await probeRadioStream(validatedUrl);

      // Decode a short buffer from the radio stream into the channel's engine
      try {
        const pcm = await decodeMediaFileToPcm(validatedUrl, 3);
        if (pcm?.length) {
          multiChannelAudio.getEngine(source.channelId, organizationId).loadSourcePcm(source.id, pcm);
        }
      } catch {
        // probe succeeded
      }

      return await audioRepo.updateAudioSourceRuntimeState(id, organizationId, {
        state: source.enabled ? AUDIO_SOURCE_STATES.PLAYING : AUDIO_SOURCE_STATES.DISABLED,
        ...probed,
        retryCount: 0,
        lastConnectedAt: new Date().toISOString(),
        lastError: null
      });
    }

    if (['UPLOADED_AUDIO', 'ADVERTISEMENT_AUDIO', 'FALLBACK_AUDIO'].includes(source.sourceType)) {
      const asset = source.mediaAssetId ? await mediaRepo.findAssetById(source.mediaAssetId, organizationId) : null;
      if (!asset || asset.processingStatus !== MEDIA_PROCESSING_STATUS.READY || !asset.hasAudio) {
        throw new Error('Linked audio asset is unavailable or not READY');
      }
      const filePath = mediaStorage.resolveKeyPath(asset.storageKey);
      const info = await mediaStorage.verifyNoSymlink(filePath);
      if (!info || !info.isFile()) throw new Error('Audio file is missing on storage volume');
      const pcm = await decodeMediaFileToPcm(filePath, 30);
      multiChannelAudio.getEngine(source.channelId, organizationId).loadSourcePcm(source.id, pcm);

      return await audioRepo.updateAudioSourceRuntimeState(id, organizationId, {
        state: source.enabled ? AUDIO_SOURCE_STATES.PLAYING : AUDIO_SOURCE_STATES.DISABLED,
        codec: asset.audioCodec || 'aac',
        sampleRateHz: asset.sampleRateHz || 48000,
        channels: asset.audioChannels || 2,
        retryCount: 0,
        lastConnectedAt: new Date().toISOString(),
        lastError: null
      });
    }

    if (source.sourceType === 'MUSIC_PLAYLIST') {
      const playlists = await mediaRepo.listPlaylists(organizationId);
      const playlist = playlists.find(p => p.id === source.playlistId);
      if (!playlist || !playlist.items?.length) throw new Error('Linked audio playlist is missing or empty');

      const validTracks = [];
      for (const item of playlist.items) {
        const asset = await mediaRepo.findAssetById(item.assetId, organizationId);
        if (asset && asset.processingStatus === MEDIA_PROCESSING_STATUS.READY && asset.hasAudio) {
          const filePath = mediaStorage.resolveKeyPath(asset.storageKey);
          const info = await mediaStorage.verifyNoSymlink(filePath).catch(() => null);
          if (info && info.isFile()) validTracks.push({ asset, filePath });
        }
      }
      if (!validTracks.length) throw new Error('Playlist contains no playable audio tracks');

      // Decode and crossfade tracks into a continuous playlist buffer
      const crossfadeMs = source.crossfadeMs ?? 1500;
      let combinedPcm = await decodeMediaFileToPcm(validTracks[0].filePath, 30);
      for (let i = 1; i < validTracks.length; i++) {
        const nextPcm = await decodeMediaFileToPcm(validTracks[i].filePath, 30);
        combinedPcm = crossfadeMs > 0
          ? crossfadePcmBuffers(combinedPcm, nextPcm, crossfadeMs)
          : Buffer.concat([combinedPcm, nextPcm]);
      }
      multiChannelAudio.getEngine(source.channelId, organizationId).loadSourcePcm(source.id, combinedPcm, {
        trackIds: validTracks.map(t => t.asset.id)
      });

      return await audioRepo.updateAudioSourceRuntimeState(id, organizationId, {
        state: source.enabled ? AUDIO_SOURCE_STATES.PLAYING : AUDIO_SOURCE_STATES.DISABLED,
        currentTrackIndex: 0,
        currentTrackAssetId: validTracks[0].asset.id,
        codec: validTracks[0].asset.audioCodec || 'mp3',
        retryCount: 0,
        lastConnectedAt: new Date().toISOString(),
        lastError: null
      });
    }

    return await audioRepo.updateAudioSourceRuntimeState(id, organizationId, {
      state: source.enabled ? AUDIO_SOURCE_STATES.ONLINE : AUDIO_SOURCE_STATES.DISABLED,
      retryCount: 0,
      lastConnectedAt: new Date().toISOString(),
      lastError: null
    });
  } catch (error) {
    const nextRetry = (source.retryCount || 0) + 1;
    const exhaustedRetries = !source.reconnectEnabled || nextRetry >= (source.maxRetries || 5);
    const hasFallback = Boolean(source.fallbackSourceId || source.fallbackAssetId);
    const nextState = exhaustedRetries
      ? (hasFallback ? AUDIO_SOURCE_STATES.FALLBACK_ACTIVE : AUDIO_SOURCE_STATES.ERROR)
      : AUDIO_SOURCE_STATES.RECONNECTING;
    const nextBackoffMs = computeReconnectBackoffMs(nextRetry, source.backoffBaseMs, source.backoffMaxMs);
    const sanitizedError = String(error.message || 'Audio source probe failed')
      .replace(/[A-Za-z]:\\[^\s"']+/g, '[local-path]')
      .slice(0, 400);

    // Clear dead buffer from engine so fallback audio takes over automatically
    multiChannelAudio.getEngine(source.channelId, organizationId).sourceBuffers.delete(source.id);

    const updated = await audioRepo.updateAudioSourceRuntimeState(id, organizationId, {
      state: nextState,
      retryCount: nextRetry,
      lastError: `${sanitizedError} (retry ${nextRetry}/${source.maxRetries}, backoff ${nextBackoffMs}ms)`
    });
    return {
      ...updated,
      nextBackoffMs,
      exhaustedRetries
    };
  }
}
