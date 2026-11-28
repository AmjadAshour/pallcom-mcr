import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { readdir, rmdir, unlink } from 'node:fs/promises';
import { isIPv4 } from 'node:net';
import os from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import {
  CHANNEL_DESIRED_STATES,
  CHANNEL_RUNTIME_STATES,
  MEDIA_PROCESSING_STATUS
} from '@mcr/shared';
import { multiChannelAudio } from '../audio/audio-mixer-engine.js';
import { mediaStorage } from '../media/storage-manager.js';
import { isPublicIPv4, isPublicSourceHostname } from '../program/input-config.js';
import { RepositoryFactory } from '../repositories/repository-factory.js';
import { computeReconnectBackoffMs } from '../sources/video-source-service.js';

const workerScript = fileURLToPath(new URL('./channel-worker.py', import.meta.url));
const HLS_FILE_REGEX = /^(?:index\.m3u8|segment\d{5,10}\.ts)$/;

function sanitizedChildEnv() {
  const env = {};
  for (const key of Object.keys(process.env)) {
    if (/^(path|systemroot|windir|temp|tmp|home|userprofile|localappdata|appdata|lang|ld_library_path|gst_registry|gst_plugin_path)$/i.test(key)) {
      env[key] = process.env[key];
    }
  }
  return env;
}

async function cleanHlsDirectory(dir) {
  if (!dir) return;
  try {
    const files = await readdir(dir);
    await Promise.allSettled(files.filter(f => HLS_FILE_REGEX.test(f)).map(f => unlink(join(dir, f))));
    await rmdir(dir);
  } catch {
    // ignore cleanup errors
  }
}

/**
 * Validates whether a camera destination URL is permitted under Phase One SSRF protections
 * OR explicitly authorized in the channel's per-source VPN / dedicated camera network allowlist.
 * Never permits localhost, cloud metadata (169.254.0.0/16), or unapproved private networks.
 */
export function validateCameraDestinationWithAllowlist(rawUrl, networkAllowlist = []) {
  if (!rawUrl || typeof rawUrl !== 'string') {
    throw Object.assign(new Error('Camera streaming URL is required'), { statusCode: 400 });
  }
  const parsed = URL.parse(rawUrl.trim());
  if (!parsed || !parsed.hostname) {
    throw Object.assign(new Error('Malformed camera URL'), { statusCode: 400 });
  }
  if (parsed.username || parsed.password || parsed.hash) {
    throw Object.assign(new Error('Do not embed credentials in camera URL; use encrypted secrets'), { statusCode: 400 });
  }
  const host = parsed.hostname.toLowerCase();

  // Always block cloud metadata and localhost even if someone attempts to add them to an allowlist
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.startsWith('169.254.') ||
    host === '0.0.0.0' ||
    host.startsWith('127.')
  ) {
    const allowLoopbackForTest =
      process.env.MCR_ALLOW_LOOPBACK_VIDEO_SOURCE_FOR_TESTS === '1' &&
      process.env.NODE_ENV !== 'production' &&
      host === '127.0.0.1';
    if (!allowLoopbackForTest) {
      throw Object.assign(
        new Error('Localhost and cloud metadata endpoints are strictly prohibited for camera connectivity'),
        { statusCode: 400 }
      );
    }
    return parsed.href;
  }

  // Check if host+port matches an explicit per-channel authorized VPN/dedicated camera network allowlist entry
  const portNum = parsed.port ? Number(parsed.port) : (parsed.protocol === 'https:' ? 443 : 80);
  const explicitlyAllowed = Array.isArray(networkAllowlist) && networkAllowlist.some(entry => {
    if (!entry || typeof entry.host !== 'string') return false;
    const matchHost = entry.host.trim().toLowerCase() === host;
    const matchPort = entry.port ? Number(entry.port) === portNum : true;
    return matchHost && matchPort;
  });

  if (explicitlyAllowed) {
    return parsed.href;
  }

  // Otherwise enforce standard public destination check
  if (!isPublicSourceHostname(host) || (isIPv4(host) && !isPublicIPv4(host))) {
    throw Object.assign(
      new Error('Camera destination is not a public IPv4 address and is not in the channel authorized camera VPN allowlist'),
      { statusCode: 400 }
    );
  }
  return parsed.href;
}

/**
 * Validates that a channel fallback configuration contains no self-references or circular loops.
 */
export function validateFallbackHierarchy(fallbackConfig = {}, channelSources = []) {
  if (!fallbackConfig || typeof fallbackConfig !== 'object') return true;
  const visited = new Set();
  let currentId = fallbackConfig.fallbackSourceId;
  while (currentId) {
    if (visited.has(currentId)) {
      throw Object.assign(new Error('Circular fallback source configuration detected'), { statusCode: 400 });
    }
    visited.add(currentId);
    const src = channelSources.find(s => s.id === currentId);
    currentId = src?.fallbackSourceId || null;
  }
  return true;
}

/**
 * Isolated Per-Channel Playout Runtime Instance.
 */
export class ChannelPlayoutInstance {
  constructor(channelId, organizationId, supervisor) {
    this.channelId = channelId;
    this.organizationId = organizationId;
    this.supervisor = supervisor;

    this.proc = null;
    this.workerStatus = null;
    this.programMonitorFrame = null;
    this.hlsDirectory = null;
    this.operationLock = Promise.resolve();
    this.pendingRequests = new Map();

    this.rotationTimer = null;
    this.audioPumpTimer = null;
    this.checkpointTimer = null;
    this.recoveryTimer = null;

    this.activeLiveSlot = 'live1';
    this.cameraExclusions = new Set();
    this.transitionHistory = [];
    this.recoveryHistory = [];
    this.stoppingIntentionally = false;
    this.crashCountInWindow = 0;
    this.lastCrashAt = 0;
    this.nextRotationDueAt = 0;
    this.nextRotationTargetIndex = 0;
  }

  serialize(fn) {
    const next = this.operationLock.then(() => fn());
    this.operationLock = next.catch(() => {});
    return next;
  }

  sendWorkerCommand(payload, waitForReply = false, timeoutMs = 8000) {
    if (!this.proc || this.proc.stdin.destroyed) {
      if (waitForReply) {
        return Promise.reject(Object.assign(new Error('Channel playout worker is not running'), { statusCode: 503 }));
      }
      return Promise.resolve(null);
    }
    const requestId = randomUUID();
    const packet = { ...payload, requestId };
    if (!waitForReply) {
      this.proc.stdin.write(JSON.stringify(packet) + '\n');
      return Promise.resolve(null);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(Object.assign(new Error(`Channel worker command ${payload.cmd} timed out`), { statusCode: 503 }));
      }, timeoutMs);
      this.pendingRequests.set(requestId, { resolve, reject, timer });
      this.proc.stdin.write(JSON.stringify(packet) + '\n');
    });
  }

  async getFullSnapshot() {
    const repo = RepositoryFactory.getChannelPlayoutRepository();
    const config = await repo.getChannelConfig(this.channelId, this.organizationId);
    const nextItem = await this._computeNextPreviewInfo(config);
    return {
      channelId: this.channelId,
      organizationId: this.organizationId,
      config,
      runtime: {
        isWorkerAlive: Boolean(this.proc && !this.proc.killed),
        workerPid: this.proc?.pid || config.workerPid || null,
        workerSessionId: config.workerSessionId,
        workerStatus: this.workerStatus,
        activeLiveSlot: this.activeLiveSlot,
        excludedCameraIds: [...this.cameraExclusions],
        nextItem,
        programMonitorAvailable: Boolean(this.programMonitorFrame && Date.now() - this.programMonitorFrame.at < 5000),
        lastTransitions: this.transitionHistory.slice(-10),
        lastRecoveries: this.recoveryHistory.slice(-10),
        resources: this.supervisor.getResourceMetrics()
      }
    };
  }

  async _computeNextPreviewInfo(config) {
    if (config.playoutMode === 'CAMERA_ROTATION') {
      const seq = Array.isArray(config.cameraSequence) ? config.cameraSequence : [];
      if (!seq.length) return null;
      const nextIdx = (config.activeCameraIndex + 1) % seq.length;
      return { kind: 'CAMERA', index: nextIdx, ...seq[nextIdx] };
    }
    const queue = Array.isArray(config.movieQueue) ? config.movieQueue : [];
    if (!queue.length) return null;
    const nextIdx = (config.activeMovieIndex + 1) % queue.length;
    return { kind: 'MOVIE', index: nextIdx, ...queue[nextIdx] };
  }

  async start(actor = null) {
    return this.serialize(async () => {
      const repo = RepositoryFactory.getChannelPlayoutRepository();
      const config = await repo.getChannelConfig(this.channelId, this.organizationId);

      // Idempotent start: if already running with live worker, return current snapshot
      if (this.proc && !this.proc.killed && [
        CHANNEL_RUNTIME_STATES.RUNNING,
        CHANNEL_RUNTIME_STATES.STARTING,
        CHANNEL_RUNTIME_STATES.FALLBACK_ACTIVE
      ].includes(config.runtimeState)) {
        return await this.getFullSnapshot();
      }

      // Admission control check before spawning a new Full HD channel worker
      this.supervisor.assertResourceAdmission(this.channelId);

      this.stoppingIntentionally = false;
      const sessionId = randomUUID();
      const udpPort = config.outputUdpPort || this.supervisor.allocateChannelUdpPort(this.channelId);

      let hlsDir = null;
      const hlsRoot = process.env.MCR_PROGRAM_HLS_DIR || os.tmpdir();
      if (config.outputHlsEnabled) {
        try {
          hlsDir = mkdtempSync(join(hlsRoot, `mcr-ch-${this.channelId.slice(0, 8)}-hls-`));
        } catch {
          hlsDir = null;
        }
      }
      this.hlsDirectory = hlsDir;

      await repo.saveChannelConfig(this.channelId, this.organizationId, {
        desiredState: CHANNEL_DESIRED_STATES.RUNNING,
        runtimeState: CHANNEL_RUNTIME_STATES.STARTING,
        outputUdpPort: udpPort,
        workerSessionId: sessionId,
        lastError: null
      }, actor ? { ...actor, auditAction: 'CHANNEL_PLAYOUT_STARTED' } : null);

      const pythonBin = process.env.MCR_PROGRAM_PYTHON || 'python';
      const proc = spawn(pythonBin, ['-u', workerScript], {
        env: sanitizedChildEnv(),
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'inherit']
      });
      this.proc = proc;

      const startupReady = new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(Object.assign(new Error('Channel playout worker startup timed out'), { statusCode: 503 }));
        }, 15000);
        this.pendingRequests.set('__startup__', { resolve, reject, timer });
      });

      const mixerConfig = await RepositoryFactory.getAudioRepository()
        .getChannelMixerConfig(this.channelId, this.organizationId);
      const externalAudioMode = [
        'EXTERNAL_REPLACES_VIDEO_AUDIO',
        'SILENT_VIDEO_WITH_INDEPENDENT_AUDIO'
      ].includes(mixerConfig.routingMode) || mixerConfig.cameraAudioMuted
        ? 'replace'
        : mixerConfig.routingMode === 'ORIGINAL_VIDEO_AUDIO_ONLY'
          ? 'off'
          : 'mix';

      proc.stdin.write(JSON.stringify({
        channelId: this.channelId,
        width: config.width || 1920,
        height: config.height || 1080,
        frameRate: config.frameRate || 25,
        videoBitrateKbps: config.videoBitrateKbps || 4500,
        gopFrames: config.gopFrames || 50,
        audioBitrateKbps: config.audioBitrateKbps || 192,
        hwAccelMode: config.hwAccelMode || 'AUTO_WITH_SW_FALLBACK',
        outputUdpPort: udpPort,
        hlsPath: hlsDir,
        externalAudioMode,
        slate: 'black'
      }) + '\n');

      createInterface({ input: proc.stdout }).on('line', line => {
        if (this.proc !== proc) return;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          return;
        }
        if (msg.programMonitor) {
          this.programMonitorFrame = { image: msg.programMonitor, at: Date.now() };
          return;
        }
        if (msg.requestId && this.pendingRequests.has(msg.requestId)) {
          const req = this.pendingRequests.get(msg.requestId);
          clearTimeout(req.timer);
          this.pendingRequests.delete(msg.requestId);
          req.resolve(msg);
        }
        if (msg.status) {
          this.workerStatus = msg.status;
          if (msg.status.state === 'running' && this.pendingRequests.has('__startup__')) {
            const startup = this.pendingRequests.get('__startup__');
            clearTimeout(startup.timer);
            this.pendingRequests.delete('__startup__');
            startup.resolve(msg.status);
          }
          if (this.nextRotationDueAt > 0 && Date.now() >= this.nextRotationDueAt) {
            const targetIdx = this.nextRotationTargetIndex;
            this.nextRotationDueAt = 0;
            void this._stepCameraRotation(targetIdx).catch(() => {});
          }
          if (msg.status.filePlayer?.ended || msg.status.filePlayer?.error) {
            void this._onMovieItemEndedOrFailed(msg.status.filePlayer);
          }
        }
      });

      proc.on('close', (code, signal) => {
        this._clearRuntimeTimers();
        for (const [, pending] of this.pendingRequests) {
          clearTimeout(pending.timer);
          pending.reject(Object.assign(new Error('Channel worker exited'), { statusCode: 503 }));
        }
        this.pendingRequests.clear();
        if (hlsDir) void cleanHlsDirectory(hlsDir);
        if (this.proc !== proc) return;
        this.proc = null;
        this.workerStatus = null;
        this.programMonitorFrame = null;

        if (!this.stoppingIntentionally) {
          void this._handleUnexpectedWorkerExit(code, signal);
        }
      });

      await startupReady;

      const nowIso = new Date().toISOString();
      await repo.updateRuntimeCheckpoint(this.channelId, this.organizationId, {
        runtimeState: CHANNEL_RUNTIME_STATES.RUNNING,
        activeEncoder: this.workerStatus?.activeEncoder || 'x264enc',
        workerPid: proc.pid,
        lastHeartbeatAt: nowIso,
        lastOutputAt: nowIso,
        lastError: null
      });

      await this._activateInitialPlayoutContent();
      this._startRuntimeTimers();

      return await this.getFullSnapshot();
    });
  }

  async stop(actor = null) {
    return this.serialize(async () => {
      const repo = RepositoryFactory.getChannelPlayoutRepository();
      this.stoppingIntentionally = true;
      this._clearRuntimeTimers();
      if (this.recoveryTimer) {
        clearTimeout(this.recoveryTimer);
        this.recoveryTimer = null;
      }

      if (this.proc && !this.proc.killed) {
        await repo.updateRuntimeCheckpoint(this.channelId, this.organizationId, {
          desiredState: CHANNEL_DESIRED_STATES.STOPPED,
          runtimeState: CHANNEL_RUNTIME_STATES.STOPPING
        });
        await new Promise(resolve => {
          const proc = this.proc;
          const killTimer = setTimeout(() => {
            try { proc.kill('SIGKILL'); } catch { /* ignore */ }
            resolve();
          }, 3000);
          proc.once('close', () => {
            clearTimeout(killTimer);
            resolve();
          });
          try {
            proc.stdin.end('stop\n');
          } catch {
            try { proc.kill(); } catch { /* ignore */ }
          }
        });
      }

      if (this.hlsDirectory) {
        await cleanHlsDirectory(this.hlsDirectory);
        this.hlsDirectory = null;
      }
      this.proc = null;
      this.workerStatus = null;
      this.programMonitorFrame = null;

      await repo.saveChannelConfig(this.channelId, this.organizationId, {
        desiredState: CHANNEL_DESIRED_STATES.STOPPED,
        runtimeState: CHANNEL_RUNTIME_STATES.STOPPED,
        workerPid: null
      }, actor ? { ...actor, auditAction: 'CHANNEL_PLAYOUT_STOPPED' } : null);

      return await this.getFullSnapshot();
    });
  }

  async restart(actor = null) {
    await this.stop(actor ? { ...actor, auditAction: 'CHANNEL_PLAYOUT_RESTART_STOP' } : null);
    return await this.start(actor ? { ...actor, auditAction: 'CHANNEL_PLAYOUT_RESTARTED' } : null);
  }

  _clearRuntimeTimers() {
    if (this.rotationTimer) {
      clearTimeout(this.rotationTimer);
      this.rotationTimer = null;
    }
    if (this.audioPumpTimer) {
      clearInterval(this.audioPumpTimer);
      this.audioPumpTimer = null;
    }
    if (this.checkpointTimer) {
      clearInterval(this.checkpointTimer);
      this.checkpointTimer = null;
    }
  }

  _startRuntimeTimers() {
    this._clearRuntimeTimers();

    // 1. Pump independent Phase Five ChannelAudioEngine PCM frames into this channel's GStreamer worker
    const audioEngine = multiChannelAudio.getEngine(this.channelId, this.organizationId);
    this.audioPumpTimer = setInterval(async () => {
      if (!this.proc || this.proc.stdin.destroyed || this.proc.stdin.writableNeedDrain) return;
      try {
        const audioRepo = RepositoryFactory.getAudioRepository();
        const mixerConfig = await audioRepo.getChannelMixerConfig(this.channelId, this.organizationId);
        const chunks = [];
        for (let f = 0; f < 2; f++) {
          const step = await audioEngine.stepFrame({ persistMeters: false });
          let pcmToPush = step.broadcastMix.pcmBuffer;
          const movieAudio = audioEngine.sourceBuffers.get('__channel_movie_audio__');
          if (movieAudio?.pcm?.length >= 3840 && step.broadcastMix.masterRmsDbfs <= -70) {
            const end = (movieAudio.cursorBytes || 0) + 3840;
            if (end <= movieAudio.pcm.length) {
              pcmToPush = movieAudio.pcm.subarray(movieAudio.cursorBytes || 0, end);
              movieAudio.cursorBytes = end === movieAudio.pcm.length ? 0 : end;
            } else {
              pcmToPush = movieAudio.pcm.subarray(0, 3840);
              movieAudio.cursorBytes = 3840;
            }
          }
          chunks.push(pcmToPush);
        }
        const combinedPcm = Buffer.concat(chunks);
        const mode = [
          'EXTERNAL_REPLACES_VIDEO_AUDIO',
          'SILENT_VIDEO_WITH_INDEPENDENT_AUDIO'
        ].includes(mixerConfig.routingMode) || mixerConfig.cameraAudioMuted
          ? 'replace'
          : mixerConfig.routingMode === 'ORIGINAL_VIDEO_AUDIO_ONLY'
            ? 'off'
            : 'mix';
        if (mode !== 'off') {
          await this.sendWorkerCommand({
            cmd: 'external_audio',
            mode,
            pcmBase64: combinedPcm.toString('base64')
          }, false);
        } else {
          await this.sendWorkerCommand({
            cmd: 'external_audio',
            mode: 'off',
            pcmBase64: ''
          }, false);
        }
      } catch {
        // ignore transient audio step error
      }
    }, 35);
    this.audioPumpTimer.unref?.();

    // 2. Bounded database checkpoint persistence (every 2.5 seconds to avoid excessive DB writes)
    this.checkpointTimer = setInterval(async () => {
      if (!this.proc || !this.workerStatus) return;
      try {
        const nowIso = new Date().toISOString();
        const fp = this.workerStatus.filePlayer || {};
        await RepositoryFactory.getChannelPlayoutRepository().updateRuntimeCheckpoint(
          this.channelId,
          this.organizationId,
          {
            lastHeartbeatAt: nowIso,
            lastOutputAt: this.workerStatus.outputBytesTotal > 0 ? nowIso : null,
            playbackPositionMs: fp.positionMs ?? 0,
            remainingDurationMs: fp.remainingMs ?? null
          }
        );
      } catch {
        // ignore transient DB checkpoint failure so live broadcast continues uninterrupted!
      }
    }, 2500);
    this.checkpointTimer.unref?.();
  }

  async _activateInitialPlayoutContent() {
    const repo = RepositoryFactory.getChannelPlayoutRepository();
    const config = await repo.getChannelConfig(this.channelId, this.organizationId);
    if (config.emergencyActive && config.emergencySourceId) {
      await this._activateSpecificSource(config.emergencySourceId, config);
      return;
    }
    if (config.playoutMode === 'CAMERA_ROTATION') {
      await this._stepCameraRotation(config.activeCameraIndex || 0);
    } else if (config.playoutMode === 'MOVIE_PLAYOUT' || config.playoutMode === 'HYBRID_PLAYOUT') {
      await this._startMovieAtIndex(config.activeMovieIndex || 0, config.playbackPositionMs || 0);
    }
  }

  /**
   * Channel One — Automatic Sequential Live Camera Rotation with Preconnection/Dual-Slot Switching,
   * Temporary Exclusion, Unavailable Camera Skipping, and Automatic Fallback.
   */
  async _stepCameraRotation(requestedIndex = null) {
    if (this.rotationTimer) {
      clearTimeout(this.rotationTimer);
      this.rotationTimer = null;
    }
    if (!this.proc) return;

    const repo = RepositoryFactory.getChannelPlayoutRepository();
    const videoSourcesRepo = RepositoryFactory.getVideoSourceRepository();
    const config = await repo.getChannelConfig(this.channelId, this.organizationId);
    const sequence = Array.isArray(config.cameraSequence) ? config.cameraSequence : [];

    if (!sequence.length) {
      await this._activateFallback(config, 'NO_CAMERAS_CONFIGURED');
      return;
    }

    const startIdx = requestedIndex !== null ? requestedIndex : (config.activeCameraIndex || 0);
    let chosenEntry = null;
    let chosenIndex = -1;

    for (let offset = 0; offset < sequence.length; offset++) {
      const idx = (startIdx + offset) % sequence.length;
      const entry = sequence[idx];
      if (!entry || entry.enabled === false || this.cameraExclusions.has(entry.sourceId || entry.id)) {
        continue;
      }
      if (entry.sourceId) {
        const vSource = await videoSourcesRepo.findSourceById(entry.sourceId, this.organizationId);
        if (vSource && (vSource.connectionStatus === 'ERROR' || vSource.availabilityStatus === 'UNAVAILABLE') && !entry.udpPort && !entry.uri) {
          continue;
        }
        chosenEntry = { ...entry, videoSource: vSource };
      } else {
        chosenEntry = entry;
      }
      chosenIndex = idx;
      break;
    }

    if (!chosenEntry) {
      await this._activateFallback(config, 'ALL_CAMERAS_UNAVAILABLE');
      // Schedule periodic check to recover automatically when a camera becomes available again
      this.nextRotationTargetIndex = 0;
      this.nextRotationDueAt = Date.now() + 2000;
      this.rotationTimer = setTimeout(() => void this._stepCameraRotation(0), 2000);
      return;
    }

    // Alternate between live1 and live2 slots so the encoder never restarts
    const nextSlot = this.activeLiveSlot === 'live1' ? 'live2' : 'live1';
    this.activeLiveSlot = nextSlot;
    const sourceId = chosenEntry.sourceId || chosenEntry.id || `cam-${chosenIndex}`;
    const udpPort = chosenEntry.udpPort || null;
    let uri = chosenEntry.uri || chosenEntry.videoSource?.streamUrl || null;

    if (uri && !udpPort) {
      uri = validateCameraDestinationWithAllowlist(uri, config.networkAllowlist);
    }

    // If the camera references a READY MediaAsset or local file, play it smoothly or feed via file:// URI
    if (!uri && !udpPort && chosenEntry.videoSource?.mediaAssetId) {
      const asset = await RepositoryFactory.getMediaRepository().findAssetById(
        chosenEntry.videoSource.mediaAssetId,
        this.organizationId
      );
      if (asset && asset.processingStatus === MEDIA_PROCESSING_STATUS.READY) {
        const filePath = mediaStorage.resolveKeyPath(asset.storageKey);
        uri = new URL(`file:///${filePath.replace(/\\/g, '/')}`).href;
      }
    }

    const t0 = performance.now();
    await this.sendWorkerCommand({
      cmd: 'configure_live',
      slot: nextSlot,
      sourceId,
      uri,
      udpPort,
      audioEnabled: false,
      switchImmediate: true
    }, true);
    const transitionMs = Math.round((performance.now() - t0) * 100) / 100;

    this.transitionHistory.push({
      at: new Date().toISOString(),
      kind: 'CAMERA_SWITCH',
      toSourceId: sourceId,
      cameraIndex: chosenIndex,
      slot: nextSlot,
      transitionMs
    });

    await repo.updateRuntimeCheckpoint(this.channelId, this.organizationId, {
      runtimeState: CHANNEL_RUNTIME_STATES.RUNNING,
      activeCameraIndex: chosenIndex,
      currentSourceId: sourceId,
      fallbackActive: false,
      lastError: null
    });

    const durationMs = Math.max(1000, Number(chosenEntry.durationSeconds || 10) * 1000);
    if (config.cameraRepeat || chosenIndex + 1 < sequence.length) {
      const nextIndex = (chosenIndex + 1) % sequence.length;
      this.nextRotationTargetIndex = nextIndex;
      this.nextRotationDueAt = Date.now() + durationMs;
      this.rotationTimer = setTimeout(() => {
        this.nextRotationDueAt = 0;
        void this._stepCameraRotation(nextIndex);
      }, durationMs);
    }
  }

  /**
   * Channel Two — Continuous Movie Playout with Queue Progression, Missing/Corrupted File Recovery,
   * Safe Seeking, Pause/Resume, and Advertisement Insertion between/during Movies.
   */
  async _startMovieAtIndex(requestedIndex = 0, seekMs = 0) {
    if (!this.proc) return;
    const repo = RepositoryFactory.getChannelPlayoutRepository();
    const mediaRepo = RepositoryFactory.getMediaRepository();
    const config = await repo.getChannelConfig(this.channelId, this.organizationId);
    const queue = Array.isArray(config.movieQueue) ? config.movieQueue : [];

    if (!queue.length) {
      await this._activateFallback(config, 'EMPTY_MOVIE_QUEUE');
      return;
    }

    for (let attempt = 0; attempt < queue.length; attempt++) {
      const idx = (requestedIndex + attempt) % queue.length;
      const item = queue[idx];
      const assetId = item?.assetId || item?.mediaAssetId || item?.id;
      if (!assetId) continue;

      const asset = await mediaRepo.findAssetById(assetId, this.organizationId);
      if (!asset || asset.processingStatus !== MEDIA_PROCESSING_STATUS.READY || !asset.hasVideo) {
        this.recoveryHistory.push({
          at: new Date().toISOString(),
          reason: 'SKIPPED_INVALID_OR_UNREADY_MOVIE',
          assetId
        });
        continue;
      }

      let filePath;
      try {
        filePath = mediaStorage.resolveKeyPath(asset.storageKey);
        const info = await mediaStorage.verifyNoSymlink(filePath);
        if (!info || !info.isFile()) throw new Error('File missing on storage disk');
      } catch {
        this.recoveryHistory.push({
          at: new Date().toISOString(),
          reason: 'SKIPPED_MISSING_MOVIE_FILE',
          assetId
        });
        continue;
      }

      const durationMs = Math.round(Number(asset.durationSeconds || item.durationSeconds || 0) * 1000);
      const effectiveSeek = attempt === 0 ? Math.max(0, Number(seekMs || 0)) : 0;

      const reply = await this.sendWorkerCommand({
        cmd: 'play_file',
        assetId: asset.id,
        sourceId: item.sourceId || asset.id,
        filePath,
        seekMs: effectiveSeek,
        durationMs
      }, true);

      if (reply?.reply === 'file_playing') {
        // Also decode and load the movie/ad audio track into ChannelAudioEngine so audio is immediately
        // available for server-side mixing, metering, and broadcast output
        try {
          const { decodeMediaFileToPcm } = await import('../audio/audio-mixer-engine.js');
          const pcm = await decodeMediaFileToPcm(filePath, 15);
          if (pcm?.length) {
            multiChannelAudio.getEngine(this.channelId, this.organizationId).loadSourcePcm('__channel_movie_audio__', pcm);
          }
        } catch {
          // ignore audio preload error
        }

        this.transitionHistory.push({
          at: new Date().toISOString(),
          kind: 'MOVIE_START',
          assetId: asset.id,
          movieIndex: idx,
          seekMs: effectiveSeek
        });

        await repo.updateRuntimeCheckpoint(this.channelId, this.organizationId, {
          runtimeState: CHANNEL_RUNTIME_STATES.RUNNING,
          activeMovieIndex: idx,
          currentMediaAssetId: asset.id,
          currentSourceId: item.sourceId || asset.id,
          playbackPositionMs: effectiveSeek,
          remainingDurationMs: durationMs > 0 ? Math.max(0, durationMs - effectiveSeek) : null,
          paused: false,
          fallbackActive: false,
          lastError: null
        });
        return;
      }

      this.recoveryHistory.push({
        at: new Date().toISOString(),
        reason: 'SKIPPED_CORRUPTED_MOVIE_FILE',
        assetId
      });
    }

    // All movies in queue were missing or corrupted -> activate fallback programming
    await this._activateFallback(config, 'ALL_MOVIES_UNAVAILABLE');
  }

  async _onMovieItemEndedOrFailed(filePlayerState) {
    if (!this.proc || this.stoppingIntentionally) return;
    const repo = RepositoryFactory.getChannelPlayoutRepository();
    const config = await repo.getChannelConfig(this.channelId, this.organizationId);
    const queue = Array.isArray(config.movieQueue) ? config.movieQueue : [];
    if (!queue.length) return;

    // If an advertisement break just finished, restore the movie queue after the ad
    if (config.adState?.active) {
      const resumeIdx = Number(config.adState.resumeMovieIndex ?? ((config.activeMovieIndex + 1) % queue.length));
      const resumePos = Number(config.adState.resumePositionMs ?? 0);
      await repo.updateRuntimeCheckpoint(this.channelId, this.organizationId, {
        adState: { active: false, currentAdAssetId: null, resumeMovieIndex: 0, resumePositionMs: 0 }
      });
      await this._startMovieAtIndex(resumeIdx, resumePos);
      return;
    }

    // Check if an advertisement is configured to play between movies
    const adPolicy = config.adSchedulePolicy || {};
    if (adPolicy.enabled && Array.isArray(adPolicy.adAssetIds) && adPolicy.adAssetIds.length > 0 && !filePlayerState.error) {
      const adAssetId = adPolicy.adAssetIds[config.activeMovieIndex % adPolicy.adAssetIds.length];
      const nextMovieIdx = (config.activeMovieIndex + 1) % queue.length;
      const playedAd = await this._playAdvertisementBreak(adAssetId, nextMovieIdx, 0);
      if (playedAd) return;
    }

    const nextIdx = config.activeMovieIndex + 1;
    if (nextIdx < queue.length || config.movieRepeat) {
      await this._startMovieAtIndex(nextIdx % queue.length, 0);
    } else {
      await this._activateFallback(config, 'MOVIE_QUEUE_COMPLETED');
    }
  }

  async _playAdvertisementBreak(adAssetId, resumeMovieIndex, resumePositionMs = 0) {
    const mediaRepo = RepositoryFactory.getMediaRepository();
    const asset = await mediaRepo.findAssetById(adAssetId, this.organizationId);
    if (!asset || asset.processingStatus !== MEDIA_PROCESSING_STATUS.READY) return false;

    try {
      const filePath = mediaStorage.resolveKeyPath(asset.storageKey);
      const durationMs = Math.round(Number(asset.durationSeconds || 15) * 1000);
      const reply = await this.sendWorkerCommand({
        cmd: 'play_file',
        assetId: asset.id,
        sourceId: `ad:${asset.id}`,
        filePath,
        seekMs: 0,
        durationMs
      }, true);
      if (reply?.reply === 'file_playing') {
        await RepositoryFactory.getChannelPlayoutRepository().updateRuntimeCheckpoint(
          this.channelId,
          this.organizationId,
          {
            currentMediaAssetId: asset.id,
            adState: {
              active: true,
              currentAdAssetId: asset.id,
              resumeMovieIndex,
              resumePositionMs
            }
          }
        );
        return true;
      }
    } catch {
      // fall through
    }
    return false;
  }

  async _activateSpecificSource(sourceId, config) {
    if (!sourceId) {
      await this.sendWorkerCommand({ cmd: 'switch_slot', slot: 'fallback', sourceId: 'fallback:slate' }, true);
      return { ok: true, mode: 'FALLBACK_SLATE', fallbackActivated: true };
    }

    const repo = RepositoryFactory.getChannelPlayoutRepository();
    const videoSourcesRepo = RepositoryFactory.getVideoSourceRepository();
    const mediaRepo = RepositoryFactory.getMediaRepository();
    const liveConfig = config || (await repo.getChannelConfig(this.channelId, this.organizationId));

    // 1. Check if sourceId matches a configured camera in config.cameraSequence (by sourceId or id)
    const sequence = Array.isArray(liveConfig.cameraSequence) ? liveConfig.cameraSequence : [];
    const camIdx = sequence.findIndex(e => e && (e.sourceId === sourceId || e.id === sourceId));
    if (camIdx >= 0) {
      const entry = sequence[camIdx];
      if (entry.enabled === false || this.cameraExclusions.has(entry.sourceId || entry.id)) {
        await this._activateFallback(liveConfig, `OVERRIDE_CAMERA_EXCLUDED:${sourceId}`);
        return { ok: false, mode: 'FALLBACK_ACTIVE', fallbackActivated: true, reason: 'OVERRIDE_CAMERA_EXCLUDED' };
      }
      if (this.rotationTimer) {
        clearTimeout(this.rotationTimer);
        this.rotationTimer = null;
      }
      const nextSlot = this.activeLiveSlot === 'live1' ? 'live2' : 'live1';
      this.activeLiveSlot = nextSlot;
      const udpPort = entry.udpPort || null;
      let uri = entry.uri || null;
      if (uri && !udpPort) {
        uri = validateCameraDestinationWithAllowlist(uri, liveConfig.networkAllowlist);
      }
      const t0 = performance.now();
      await this.sendWorkerCommand({
        cmd: 'configure_live',
        slot: nextSlot,
        sourceId: entry.sourceId || entry.id,
        uri,
        udpPort,
        audioEnabled: false,
        switchImmediate: true
      }, true);
      const transitionMs = Math.round((performance.now() - t0) * 100) / 100;
      this.transitionHistory.push({
        at: new Date().toISOString(),
        kind: 'MANUAL_OVERRIDE_CAMERA_SWITCH',
        toSourceId: entry.sourceId || entry.id,
        cameraIndex: camIdx,
        slot: nextSlot,
        transitionMs
      });
      await repo.updateRuntimeCheckpoint(this.channelId, this.organizationId, {
        runtimeState: CHANNEL_RUNTIME_STATES.RUNNING,
        activeCameraIndex: camIdx,
        currentSourceId: entry.sourceId || entry.id,
        fallbackActive: false,
        lastError: null
      });
      return { ok: true, mode: 'CAMERA_SLOT', fallbackActivated: false, transitionMs };
    }

    // 2. Check if sourceId matches an organization-scoped VideoSource
    const vSource = await videoSourcesRepo.findSourceById(sourceId, this.organizationId);
    if (vSource) {
      if (vSource.stationId && vSource.stationId !== this.channelId) {
        throw Object.assign(new Error(`VideoSource ${sourceId} belongs to a different channel`), { statusCode: 403 });
      }
      if (vSource.connectionStatus === 'ERROR' || vSource.availabilityStatus === 'UNAVAILABLE') {
        await this._activateFallback(liveConfig, `OVERRIDE_SOURCE_UNAVAILABLE:${sourceId}`);
        return { ok: false, mode: 'FALLBACK_ACTIVE', fallbackActivated: true, reason: 'OVERRIDE_SOURCE_UNAVAILABLE' };
      }
      if (vSource.mediaAssetId) {
        const asset = await mediaRepo.findAssetById(vSource.mediaAssetId, this.organizationId);
        if (asset && asset.processingStatus === MEDIA_PROCESSING_STATUS.READY && asset.hasVideo) {
          try {
            const filePath = mediaStorage.resolveKeyPath(asset.storageKey);
            const info = await mediaStorage.verifyNoSymlink(filePath);
            if (!info || !info.isFile()) throw new Error('Missing file');
            const reply = await this.sendWorkerCommand({
              cmd: 'play_file',
              assetId: asset.id,
              sourceId: vSource.id,
              filePath,
              seekMs: 0,
              durationMs: Math.round(Number(asset.durationSeconds || 0) * 1000)
            }, true);
            if (reply?.reply === 'file_playing') {
              await repo.updateRuntimeCheckpoint(this.channelId, this.organizationId, {
                runtimeState: CHANNEL_RUNTIME_STATES.RUNNING,
                currentMediaAssetId: asset.id,
                currentSourceId: vSource.id,
                fallbackActive: false,
                lastError: null
              });
              return { ok: true, mode: 'VIDEO_SOURCE_MEDIA', fallbackActivated: false };
            }
          } catch {
            // Fall through to fallback
          }
        }
        await this._activateFallback(liveConfig, `OVERRIDE_SOURCE_MEDIA_INVALID:${sourceId}`);
        return { ok: false, mode: 'FALLBACK_ACTIVE', fallbackActivated: true, reason: 'OVERRIDE_SOURCE_MEDIA_INVALID' };
      }
      if (vSource.streamUrl) {
        try {
          if (this.rotationTimer) {
            clearTimeout(this.rotationTimer);
            this.rotationTimer = null;
          }
          const nextSlot = this.activeLiveSlot === 'live1' ? 'live2' : 'live1';
          this.activeLiveSlot = nextSlot;
          let udpPort = null;
          let uri = vSource.streamUrl;
          const udpMatch = /^udp:\/\/127\.0\.0\.1:(\d+)/i.exec(uri);
          if (udpMatch) {
            udpPort = Number(udpMatch[1]);
            uri = null;
          } else {
            uri = validateCameraDestinationWithAllowlist(uri, liveConfig.networkAllowlist);
          }
          await this.sendWorkerCommand({
            cmd: 'configure_live',
            slot: nextSlot,
            sourceId: vSource.id,
            uri,
            udpPort,
            audioEnabled: false,
            switchImmediate: true
          }, true);
          await repo.updateRuntimeCheckpoint(this.channelId, this.organizationId, {
            runtimeState: CHANNEL_RUNTIME_STATES.RUNNING,
            currentSourceId: vSource.id,
            fallbackActive: false,
            lastError: null
          });
          return { ok: true, mode: 'VIDEO_SOURCE_STREAM', fallbackActivated: false };
        } catch {
          await this._activateFallback(liveConfig, `OVERRIDE_STREAM_FAILED:${sourceId}`);
          return { ok: false, mode: 'FALLBACK_ACTIVE', fallbackActivated: true, reason: 'OVERRIDE_STREAM_FAILED' };
        }
      }
    }

    // 3. Check if sourceId matches an organization-scoped MediaAsset
    const asset = await mediaRepo.findAssetById(sourceId, this.organizationId);
    if (asset) {
      if (asset.processingStatus === MEDIA_PROCESSING_STATUS.READY && asset.hasVideo) {
        try {
          const filePath = mediaStorage.resolveKeyPath(asset.storageKey);
          const info = await mediaStorage.verifyNoSymlink(filePath);
          if (!info || !info.isFile()) throw new Error('Override media file missing on disk');
          if (this.rotationTimer) {
            clearTimeout(this.rotationTimer);
            this.rotationTimer = null;
          }
          const durationMs = Math.round(Number(asset.durationSeconds || 0) * 1000);
          const reply = await this.sendWorkerCommand({
            cmd: 'play_file',
            assetId: asset.id,
            sourceId: asset.id,
            filePath,
            seekMs: 0,
            durationMs
          }, true);
          if (reply?.reply === 'file_playing') {
            try {
              const { decodeMediaFileToPcm } = await import('../audio/audio-mixer-engine.js');
              const pcm = await decodeMediaFileToPcm(filePath, 15);
              if (pcm?.length) {
                multiChannelAudio.getEngine(this.channelId, this.organizationId).loadSourcePcm('__channel_movie_audio__', pcm);
              }
            } catch {}
            this.transitionHistory.push({
              at: new Date().toISOString(),
              kind: 'OVERRIDE_MEDIA_PLAY',
              assetId: asset.id
            });
            await repo.updateRuntimeCheckpoint(this.channelId, this.organizationId, {
              runtimeState: CHANNEL_RUNTIME_STATES.RUNNING,
              currentMediaAssetId: asset.id,
              currentSourceId: asset.id,
              playbackPositionMs: 0,
              remainingDurationMs: durationMs || null,
              paused: false,
              fallbackActive: false,
              lastError: null
            });
            return { ok: true, mode: 'MEDIA_ASSET', fallbackActivated: false };
          }
        } catch {
          // Fall through to fallback activation below
        }
      }
      await this._activateFallback(liveConfig, `OVERRIDE_ASSET_UNPLAYABLE:${sourceId}`);
      return { ok: false, mode: 'FALLBACK_ACTIVE', fallbackActivated: true, reason: 'OVERRIDE_ASSET_UNPLAYABLE' };
    }

    // 4. Explicit slate or unrecognized/failed source -> activate channel fallback
    if (sourceId === 'emergency:slate' || sourceId === 'fallback:slate') {
      await this.sendWorkerCommand({ cmd: 'switch_slot', slot: 'fallback', sourceId }, true);
      await repo.updateRuntimeCheckpoint(this.channelId, this.organizationId, {
        runtimeState: CHANNEL_RUNTIME_STATES.FALLBACK_ACTIVE,
        currentSourceId: sourceId,
        fallbackActive: true
      });
      return { ok: true, mode: 'EMERGENCY_SLATE', fallbackActivated: true };
    }

    await this._activateFallback(liveConfig, `OVERRIDE_SOURCE_FAILED:${sourceId}`);
    return { ok: false, mode: 'FALLBACK_ACTIVE', fallbackActivated: true, reason: 'OVERRIDE_SOURCE_FAILED' };
  }

  async _activateFallback(config, reason) {
    if (!this.proc) return;
    const fb = config.fallbackConfig || {};
    let activatedMedia = false;

    if (fb.fallbackAssetId) {
      const asset = await RepositoryFactory.getMediaRepository().findAssetById(fb.fallbackAssetId, this.organizationId);
      if (asset && asset.processingStatus === MEDIA_PROCESSING_STATUS.READY && asset.hasVideo) {
        try {
          const filePath = mediaStorage.resolveKeyPath(asset.storageKey);
          const reply = await this.sendWorkerCommand({
            cmd: 'play_file',
            assetId: asset.id,
            sourceId: `fallback:${asset.id}`,
            filePath,
            seekMs: 0,
            durationMs: Math.round(Number(asset.durationSeconds || 0) * 1000)
          }, true);
          activatedMedia = reply?.reply === 'file_playing';
        } catch {
          activatedMedia = false;
        }
      }
    }

    if (!activatedMedia) {
      await this.sendWorkerCommand({ cmd: 'switch_slot', slot: 'fallback', sourceId: 'fallback:slate' }, true);
    }

    this.recoveryHistory.push({
      at: new Date().toISOString(),
      reason,
      fallbackMode: fb.mode || 'BLACK_SLATE'
    });

    await RepositoryFactory.getChannelPlayoutRepository().updateRuntimeCheckpoint(
      this.channelId,
      this.organizationId,
      {
        runtimeState: CHANNEL_RUNTIME_STATES.FALLBACK_ACTIVE,
        fallbackActive: true,
        lastError: reason
      }
    );
  }

  /**
   * Automatic Bounded Crash-Loop-Protected Worker Recovery.
   */
  async _handleUnexpectedWorkerExit(code, signal) {
    const repo = RepositoryFactory.getChannelPlayoutRepository();
    const config = await repo.getChannelConfig(this.channelId, this.organizationId);
    if (config.desiredState !== CHANNEL_DESIRED_STATES.RUNNING) return;

    const now = Date.now();
    if (now - this.lastCrashAt > 60000) {
      this.crashCountInWindow = 0;
    }
    this.crashCountInWindow += 1;
    this.lastCrashAt = now;

    const nextRestartCount = (config.restartCount || 0) + 1;
    const maxRestartsInWindow = 5;

    if (this.crashCountInWindow > maxRestartsInWindow) {
      await repo.updateRuntimeCheckpoint(this.channelId, this.organizationId, {
        runtimeState: CHANNEL_RUNTIME_STATES.FAILED,
        workerPid: null,
        restartCount: nextRestartCount,
        lastError: `Worker crash loop prevented after ${this.crashCountInWindow} crashes (exit=${code}, signal=${signal})`
      });
      return;
    }

    const backoffMs = computeReconnectBackoffMs(this.crashCountInWindow, 500, 8000);
    await repo.updateRuntimeCheckpoint(this.channelId, this.organizationId, {
      runtimeState: CHANNEL_RUNTIME_STATES.RECOVERING,
      workerPid: null,
      restartCount: nextRestartCount,
      lastError: `Worker exited unexpectedly (code=${code}, signal=${signal}); recovering in ${backoffMs}ms`
    });

    const crashDetectedAt = performance.now();
    this.recoveryTimer = setTimeout(async () => {
      this.recoveryTimer = null;
      try {
        await this.start(null);
        const recoveryMs = Math.round(performance.now() - crashDetectedAt);
        const nowIso = new Date().toISOString();
        this.recoveryHistory.push({
          at: nowIso,
          reason: 'WORKER_CRASH_RECOVERED',
          recoveryMs,
          restartCount: nextRestartCount
        });
        await repo.updateRuntimeCheckpoint(this.channelId, this.organizationId, {
          lastRecoveryAt: nowIso
        });
      } catch (err) {
        await repo.updateRuntimeCheckpoint(this.channelId, this.organizationId, {
          runtimeState: CHANNEL_RUNTIME_STATES.FAILED,
          lastError: err.message || 'Recovery failed'
        });
      }
    }, backoffMs);
    this.recoveryTimer.unref?.();
  }

  // Runtime Control Actions
  async switchCameraManual(cameraIndex, actor = null) {
    return this.serialize(async () => {
      await this._stepCameraRotation(cameraIndex);
      if (actor) {
        await RepositoryFactory.getAuditRepository().create({
          organizationId: this.organizationId,
          userId: actor.id,
          action: 'CHANNEL_CAMERA_MANUAL_SWITCH',
          resourceType: 'ChannelPlayoutConfig',
          resourceId: this.channelId,
          details: { channelId: this.channelId, cameraIndex },
          ipAddress: actor.ipAddress
        });
      }
      return await this.getFullSnapshot();
    });
  }

  async setCameraExclusion(sourceId, excluded, actor = null) {
    return this.serialize(async () => {
      if (excluded) this.cameraExclusions.add(sourceId);
      else this.cameraExclusions.delete(sourceId);

      const config = await RepositoryFactory.getChannelPlayoutRepository().getChannelConfig(
        this.channelId,
        this.organizationId
      );
      if (excluded && config.currentSourceId === sourceId && this.proc) {
        await this._stepCameraRotation((config.activeCameraIndex + 1));
      } else if (!excluded && config.fallbackActive && this.proc) {
        await this._stepCameraRotation(0);
      }

      if (actor) {
        await RepositoryFactory.getAuditRepository().create({
          organizationId: this.organizationId,
          userId: actor.id,
          action: excluded ? 'CHANNEL_CAMERA_EXCLUDED' : 'CHANNEL_CAMERA_INCLUDED',
          resourceType: 'ChannelPlayoutConfig',
          resourceId: this.channelId,
          details: { channelId: this.channelId, sourceId, excluded },
          ipAddress: actor.ipAddress
        });
      }
      return await this.getFullSnapshot();
    });
  }

  async selectMovieManual(movieIndex, seekMs = 0, actor = null) {
    return this.serialize(async () => {
      await this._startMovieAtIndex(movieIndex, seekMs);
      if (actor) {
        await RepositoryFactory.getAuditRepository().create({
          organizationId: this.organizationId,
          userId: actor.id,
          action: 'CHANNEL_MOVIE_MANUAL_SELECT',
          resourceType: 'ChannelPlayoutConfig',
          resourceId: this.channelId,
          details: { channelId: this.channelId, movieIndex, seekMs },
          ipAddress: actor.ipAddress
        });
      }
      return await this.getFullSnapshot();
    });
  }

  async seekMovie(positionMs, actor = null) {
    return this.serialize(async () => {
      await this.sendWorkerCommand({ cmd: 'seek_file', positionMs }, true);
      await RepositoryFactory.getChannelPlayoutRepository().updateRuntimeCheckpoint(
        this.channelId,
        this.organizationId,
        { playbackPositionMs: positionMs }
      );
      if (actor) {
        await RepositoryFactory.getAuditRepository().create({
          organizationId: this.organizationId,
          userId: actor.id,
          action: 'CHANNEL_MOVIE_SEEK',
          resourceType: 'ChannelPlayoutConfig',
          resourceId: this.channelId,
          details: { channelId: this.channelId, positionMs },
          ipAddress: actor.ipAddress
        });
      }
      return await this.getFullSnapshot();
    });
  }

  async setMoviePaused(paused, actor = null) {
    return this.serialize(async () => {
      await this.sendWorkerCommand({ cmd: paused ? 'pause_file' : 'resume_file' }, true);
      await RepositoryFactory.getChannelPlayoutRepository().updateRuntimeCheckpoint(
        this.channelId,
        this.organizationId,
        { paused: Boolean(paused) }
      );
      if (actor) {
        await RepositoryFactory.getAuditRepository().create({
          organizationId: this.organizationId,
          userId: actor.id,
          action: paused ? 'CHANNEL_MOVIE_PAUSED' : 'CHANNEL_MOVIE_RESUMED',
          resourceType: 'ChannelPlayoutConfig',
          resourceId: this.channelId,
          details: { channelId: this.channelId, paused },
          ipAddress: actor.ipAddress
        });
      }
      return await this.getFullSnapshot();
    });
  }

  async triggerManualSourceOverride({ sourceId }, actor = null) {
    return this.serialize(async () => {
      const repo = RepositoryFactory.getChannelPlayoutRepository();
      const config = await repo.getChannelConfig(this.channelId, this.organizationId);
      let outcome = { ok: false, workerConfirmed: false, mode: 'CONFIG_ONLY', fallbackActivated: false };
      if (this.proc && !this.proc.killed) {
        const res = await this._activateSpecificSource(sourceId, config);
        outcome = { ...res, workerConfirmed: true };
      } else {
        await repo.updateRuntimeCheckpoint(this.channelId, this.organizationId, {
          currentSourceId: sourceId
        });
      }
      if (actor) {
        await RepositoryFactory.getAuditRepository().create({
          organizationId: this.organizationId,
          userId: actor.id,
          action: 'CHANNEL_MANUAL_SOURCE_OVERRIDE',
          resourceType: 'ChannelPlayoutConfig',
          resourceId: this.channelId,
          details: { channelId: this.channelId, sourceId, ...outcome },
          ipAddress: actor.ipAddress
        });
      }
      return { outcome, snapshot: await this.getFullSnapshot() };
    });
  }

  async triggerEmergencySwitch({ enabled, emergencySourceId = null }, actor) {
    return this.serialize(async () => {
      const repo = RepositoryFactory.getChannelPlayoutRepository();
      const currentCfg = await repo.getChannelConfig(this.channelId, this.organizationId);
      const config = await repo.saveChannelConfig(this.channelId, this.organizationId, {
        emergencyActive: Boolean(enabled),
        emergencySourceId: enabled ? emergencySourceId : null,
        runtimeState: enabled ? CHANNEL_RUNTIME_STATES.FALLBACK_ACTIVE : currentCfg?.runtimeState || CHANNEL_RUNTIME_STATES.RUNNING
      }, { ...actor, auditAction: enabled ? 'CHANNEL_EMERGENCY_ACTIVATED' : 'CHANNEL_EMERGENCY_CLEARED' });

      if (this.proc && !this.proc.killed) {
        if (enabled) {
          if (this.rotationTimer) {
            clearTimeout(this.rotationTimer);
            this.rotationTimer = null;
          }
          if (emergencySourceId) {
            await this._activateSpecificSource(emergencySourceId, config);
          } else {
            await this._activateSpecificSource('emergency:slate', config);
          }
        } else {
          await this._activateInitialPlayoutContent();
        }
      }
      return await this.getFullSnapshot();
    });
  }
}

/**
 * Multi-Channel Playout Supervisor.
 * Enforces resource admission controls, per-channel isolation, and automatic recovery on boot.
 */
export class MultiChannelPlayoutSupervisor {
  constructor() {
    this.instances = new Map(); // `${organizationId}:${channelId}` -> ChannelPlayoutInstance
    this.nextDynamicUdpPort = 26100;
    this.channelPorts = new Map();
  }

  getInstance(channelId, organizationId) {
    const key = `${organizationId}:${channelId}`;
    let inst = this.instances.get(key);
    if (!inst) {
      inst = new ChannelPlayoutInstance(channelId, organizationId, this);
      this.instances.set(key, inst);
    }
    return inst;
  }

  allocateChannelUdpPort(channelId) {
    if (this.channelPorts.has(channelId)) return this.channelPorts.get(channelId);
    const port = this.nextDynamicUdpPort;
    this.nextDynamicUdpPort += 2;
    this.channelPorts.set(channelId, port);
    return port;
  }

  getActiveWorkerCount() {
    let count = 0;
    for (const inst of this.instances.values()) {
      if (inst.proc && !inst.proc.killed) count += 1;
    }
    return count;
  }

  getResourceMetrics() {
    const mem = process.memoryUsage();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const maxConcurrentChannels = Number(process.env.MCR_MAX_CONCURRENT_CHANNELS || 4);
    const minFreeMemoryMb = Number(process.env.MCR_MIN_FREE_MEMORY_MB || 256);

    return {
      activeWorkers: this.getActiveWorkerCount(),
      maxConcurrentChannels,
      processRssMb: Math.round((mem.rss / (1024 * 1024)) * 10) / 10,
      hostFreeMemoryMb: Math.round(freeMem / (1024 * 1024)),
      hostTotalMemoryMb: Math.round(totalMem / (1024 * 1024)),
      minFreeMemoryMb,
      cpuCount: os.cpus().length,
      loadAvg1m: Math.round((os.loadavg()[0] || 0) * 100) / 100
    };
  }

  assertResourceAdmission(channelId) {
    const metrics = this.getResourceMetrics();
    // If this channel already owns a running worker, permit
    for (const inst of this.instances.values()) {
      if (inst.channelId === channelId && inst.proc && !inst.proc.killed) return metrics;
    }
    if (metrics.activeWorkers >= metrics.maxConcurrentChannels) {
      throw Object.assign(
        new Error(`Resource admission denied: maximum concurrent broadcast channels (${metrics.maxConcurrentChannels}) reached`),
        { statusCode: 503 }
      );
    }
    if (process.env.MCR_TEST_SIMULATED_FREE_MEMORY_MB !== undefined) {
      const simFree = Number(process.env.MCR_TEST_SIMULATED_FREE_MEMORY_MB);
      if (simFree < metrics.minFreeMemoryMb) {
        throw Object.assign(
          new Error(`Resource admission denied: insufficient host free RAM (${simFree} MB < ${metrics.minFreeMemoryMb} MB)`),
          { statusCode: 503 }
        );
      }
    }
    return metrics;
  }

  async stopAll() {
    const stops = [];
    for (const inst of this.instances.values()) {
      stops.push(inst.stop(null).catch(() => {}));
    }
    await Promise.allSettled(stops);
  }
}

export const multiChannelPlayout = new MultiChannelPlayoutSupervisor();
