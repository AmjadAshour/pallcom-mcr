import { execFile } from 'node:child_process';
import { lookup } from 'node:dns/promises';
import { isIPv4 } from 'node:net';
import { promisify } from 'node:util';
import {
  MEDIA_PROCESSING_STATUS,
  VIDEO_SOURCE_AVAILABILITY,
  VIDEO_SOURCE_CONNECTION_STATUS
} from '@mcr/shared';
import { env } from '../../config/env.js';
import { agentGateway } from '../agent/agent-gateway.js';
import { isPublicIPv4, isPublicSourceHostname } from '../program/input-config.js';
import { RepositoryFactory } from '../repositories/repository-factory.js';
import { CryptoService } from '../security/crypto-service.js';
import { mediaStorage } from '../media/storage-manager.js';

const runFile = promisify(execFile);

const PROTOCOL_SCHEMES = {
  HLS_STREAM: ['https:'],
  REMOTE_VIDEO_URL: ['https:'],
  RTMP_STREAM: ['rtmp:', 'rtmps:'],
  SRT_STREAM: ['srt:'],
  RTSP_STREAM: ['rtsp:', 'rtsps:']
};

function childEnvironment() {
  return Object.fromEntries(
    Object.entries(process.env).filter(([name]) =>
      /^(path|systemroot|windir|temp|tmp|lang|ld_library_path)$/i.test(name)
    )
  );
}

function parseFrameRate(rateStr) {
  if (!rateStr || typeof rateStr !== 'string') return null;
  const [num, den] = rateStr.split('/').map(Number);
  if (!Number.isFinite(num) || !num) return null;
  if (den === undefined) return Number(num.toFixed(3));
  if (!Number.isFinite(den) || den <= 0) return null;
  return Number((num / den).toFixed(3));
}

export function computeReconnectBackoffMs(retryCount, baseMs = 2000, maxMs = 30000) {
  const safeRetry = Math.max(0, Number(retryCount) || 0);
  return Math.min(maxMs, baseMs * (2 ** Math.min(safeRetry, 10)));
}

export async function validateVideoSourceUrl(sourceType, rawUrl, resolveIPv4 = null) {
  if (!rawUrl || typeof rawUrl !== 'string') {
    throw Object.assign(new Error('Stream or video URL is required for this source type'), { statusCode: 400 });
  }
  const parsed = URL.parse(rawUrl.trim());
  if (!parsed || !parsed.hostname) {
    throw Object.assign(new Error('Invalid video source URL'), { statusCode: 400 });
  }
  if (parsed.username || parsed.password || parsed.hash) {
    throw Object.assign(
      new Error('Do not embed credentials or fragments in the source URL; use the dedicated encrypted secret field'),
      { statusCode: 400 }
    );
  }

  const allowLoopbackFixture = process.env.MCR_ALLOW_LOOPBACK_VIDEO_SOURCE_FOR_TESTS === '1' &&
    process.env.NODE_ENV !== 'production' &&
    parsed.hostname === '127.0.0.1';

  const allowedProtocols = [...(PROTOCOL_SCHEMES[sourceType] || [])];
  if (allowLoopbackFixture && ['HLS_STREAM', 'REMOTE_VIDEO_URL'].includes(sourceType)) {
    allowedProtocols.push('http:');
  }
  if (!allowedProtocols.includes(parsed.protocol)) {
    throw Object.assign(
      new Error(`Source type ${sourceType} requires protocol ${PROTOCOL_SCHEMES[sourceType]?.join(' or ')}`),
      { statusCode: 400 }
    );
  }

  // DRM / widevine / playready / fairplay manifest markers are prohibited
  if (/(?:widevine|playready|fairplay|drm|\.key$)/i.test(parsed.pathname + parsed.search)) {
    throw Object.assign(new Error('DRM-protected or restricted stream URLs are prohibited'), { statusCode: 400 });
  }

  if (sourceType === 'SRT_STREAM') {
    if (!parsed.port || Number(parsed.port) < 1024 || Number(parsed.port) > 65535) {
      throw Object.assign(new Error('SRT stream URL requires an explicit port between 1024 and 65535'), { statusCode: 400 });
    }
    const modes = parsed.searchParams.getAll('mode');
    if (modes.some(m => m !== 'caller')) {
      throw Object.assign(new Error('SRT video source must operate in caller mode'), { statusCode: 400 });
    }
  }

  if (!allowLoopbackFixture) {
    if (!isPublicSourceHostname(parsed.hostname)) {
      throw Object.assign(new Error('Video source URL hostname is not a permitted public destination'), { statusCode: 400 });
    }
    if (isIPv4(parsed.hostname)) {
      if (!isPublicIPv4(parsed.hostname)) {
        throw Object.assign(new Error('Video source URL IPv4 address is not a permitted public destination'), { statusCode: 400 });
      }
    } else {
      const resolver = resolveIPv4 || (async host => {
        const records = await lookup(host, { family: 4, all: true, verbatim: true });
        return records.map(r => r.address);
      });
      const addresses = await resolver(parsed.hostname).catch(() => []);
      if (!addresses.length || !addresses.every(addr => isPublicIPv4(addr))) {
        throw Object.assign(
          new Error('Video source hostname resolved to a private, non-public, or unreachable IPv4 address'),
          { statusCode: 400 }
        );
      }
    }
  }

  return parsed.href;
}

export async function validateAndPrepareVideoSourceInput(organizationId, input) {
  const mediaRepo = RepositoryFactory.getMediaRepository();
  const stationRepo = RepositoryFactory.getStationRepository();
  const sourceRepo = RepositoryFactory.getVideoSourceRepository();

  const {
    sourceType,
    stationId = null,
    mediaAssetId = null,
    playlistId = null,
    streamUrl = null,
    secret = null,
    serverFilePath = null,
    fallbackSourceId = null,
    fallbackAssetId = null,
    fallbackMode = 'SLATE'
  } = input;

  if (stationId) {
    const station = await stationRepo.findById(stationId, organizationId);
    if (!station) throw Object.assign(new Error('Station not found in organization'), { statusCode: 404 });
  }

  if (fallbackSourceId) {
    const fbSource = await sourceRepo.findSourceById(fallbackSourceId, organizationId);
    if (!fbSource) throw Object.assign(new Error('Fallback video source not found'), { statusCode: 404 });
  }

  if (fallbackAssetId) {
    const fbAsset = await mediaRepo.findAssetById(fallbackAssetId, organizationId);
    if (!fbAsset || fbAsset.processingStatus !== MEDIA_PROCESSING_STATUS.READY) {
      throw Object.assign(new Error('Fallback media asset must exist and be READY'), { statusCode: 400 });
    }
  }

  let initialProbe = {
    connectionStatus: VIDEO_SOURCE_CONNECTION_STATUS.OFFLINE,
    availabilityStatus: VIDEO_SOURCE_AVAILABILITY.UNAVAILABLE,
    width: null,
    height: null,
    frameRate: null,
    videoCodec: null,
    audioCodec: null,
    hasAudio: false,
    previewThumbnailKey: null,
    lastConnectedAt: null,
    lastError: null
  };

  let normalizedUrl = null;
  let normalizedServerFile = null;
  let encryptedSecret = null;

  if (secret && typeof secret === 'string' && secret.trim()) {
    encryptedSecret = CryptoService.encryptSecret(secret.trim());
  }

  if (sourceType === 'UPLOADED_FILE' || sourceType === 'MOVIE') {
    if (!mediaAssetId) {
      throw Object.assign(new Error(`${sourceType} requires a validated mediaAssetId`), { statusCode: 400 });
    }
    const asset = await mediaRepo.findAssetById(mediaAssetId, organizationId);
    if (!asset) throw Object.assign(new Error('Media asset not found'), { statusCode: 404 });
    if (asset.processingStatus !== MEDIA_PROCESSING_STATUS.READY || asset.kind !== 'VIDEO') {
      throw Object.assign(new Error('Media asset must be a READY validated video file'), { statusCode: 409 });
    }
    initialProbe = {
      connectionStatus: VIDEO_SOURCE_CONNECTION_STATUS.ONLINE,
      availabilityStatus: VIDEO_SOURCE_AVAILABILITY.AVAILABLE,
      width: asset.width,
      height: asset.height,
      frameRate: asset.frameRate,
      videoCodec: asset.videoCodec,
      audioCodec: asset.audioCodec,
      hasAudio: asset.hasAudio,
      previewThumbnailKey: asset.thumbnailKey,
      lastConnectedAt: new Date().toISOString(),
      lastError: null
    };
  } else if (sourceType === 'PLAYLIST') {
    if (!playlistId) {
      throw Object.assign(new Error('PLAYLIST source requires a playlistId'), { statusCode: 400 });
    }
    const playlists = await mediaRepo.listPlaylists(organizationId, { kind: 'VIDEO' });
    const playlist = playlists.find(p => p.id === playlistId);
    if (!playlist || !playlist.items?.length) {
      throw Object.assign(new Error('Video playlist not found or empty'), { statusCode: 404 });
    }
    const firstAsset = await mediaRepo.findAssetById(playlist.items[0].assetId, organizationId);
    initialProbe = {
      connectionStatus: VIDEO_SOURCE_CONNECTION_STATUS.ONLINE,
      availabilityStatus: VIDEO_SOURCE_AVAILABILITY.AVAILABLE,
      width: firstAsset?.width ?? 1920,
      height: firstAsset?.height ?? 1080,
      frameRate: firstAsset?.frameRate ?? 25,
      videoCodec: firstAsset?.videoCodec ?? 'h264',
      audioCodec: firstAsset?.audioCodec ?? 'aac',
      hasAudio: Boolean(firstAsset?.hasAudio),
      previewThumbnailKey: firstAsset?.thumbnailKey ?? null,
      lastConnectedAt: new Date().toISOString(),
      lastError: null
    };
  } else if (sourceType === 'OBS_LIVE') {
    if (!stationId) {
      throw Object.assign(new Error('OBS_LIVE source requires a stationId'), { statusCode: 400 });
    }
    const station = await stationRepo.findById(stationId, organizationId);
    const connected = agentGateway.isAgentOnline(stationId) || station?.status === 'ONLINE';
    initialProbe = {
      connectionStatus: connected ? VIDEO_SOURCE_CONNECTION_STATUS.ONLINE : VIDEO_SOURCE_CONNECTION_STATUS.OFFLINE,
      availabilityStatus: connected ? VIDEO_SOURCE_AVAILABILITY.AVAILABLE : VIDEO_SOURCE_AVAILABILITY.UNAVAILABLE,
      width: 1920,
      height: 1080,
      frameRate: station?.fps || 25,
      videoCodec: 'h264',
      audioCodec: 'aac',
      hasAudio: true,
      previewThumbnailKey: null,
      lastConnectedAt: connected ? new Date().toISOString() : null,
      lastError: connected ? null : 'OBS station Agent is currently offline'
    };
  } else if (sourceType === 'SERVER_FILE') {
    if (!serverFilePath) {
      throw Object.assign(new Error('SERVER_FILE source requires a relative filename inside the authorized import directory'), { statusCode: 400 });
    }
    const resolved = await mediaStorage.resolveImportSource(serverFilePath);
    normalizedServerFile = resolved.filename;
    initialProbe = {
      connectionStatus: VIDEO_SOURCE_CONNECTION_STATUS.ONLINE,
      availabilityStatus: VIDEO_SOURCE_AVAILABILITY.AVAILABLE,
      width: null,
      height: null,
      frameRate: null,
      videoCodec: null,
      audioCodec: null,
      hasAudio: false,
      previewThumbnailKey: null,
      lastConnectedAt: new Date().toISOString(),
      lastError: null
    };
  } else if (['HLS_STREAM', 'RTMP_STREAM', 'SRT_STREAM', 'RTSP_STREAM', 'REMOTE_VIDEO_URL'].includes(sourceType)) {
    normalizedUrl = await validateVideoSourceUrl(sourceType, streamUrl);
  } else {
    throw Object.assign(new Error(`Unsupported video source type: ${sourceType}`), { statusCode: 400 });
  }

  return {
    normalizedUrl,
    normalizedServerFile,
    encryptedSecret,
    initialProbe,
    fallbackMode
  };
}

async function probeStreamOrFileWithFfprobe(targetPathOrUrl) {
  const ffprobeBin = process.env.FFPROBE_PATH || 'ffprobe';
  const { stdout } = await runFile(
    ffprobeBin,
    [
      '-v', 'error',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      targetPathOrUrl
    ],
    {
      env: childEnvironment(),
      windowsHide: true,
      timeout: Math.min(15000, env.MEDIA_PROCESSING_TIMEOUT_MS),
      maxBuffer: 1024 * 1024
    }
  );
  const parsed = JSON.parse(stdout);
  const streams = Array.isArray(parsed?.streams) ? parsed.streams : [];
  const video = streams.find(s => s.codec_type === 'video' && s.disposition?.attached_pic !== 1);
  const audio = streams.find(s => s.codec_type === 'audio');
  if (!video) {
    throw new Error('Probed source does not contain an active video stream');
  }
  return {
    width: video.width ? Number(video.width) : null,
    height: video.height ? Number(video.height) : null,
    frameRate: parseFrameRate(video.avg_frame_rate) || parseFrameRate(video.r_frame_rate),
    videoCodec: video.codec_name?.toLowerCase() || null,
    audioCodec: audio?.codec_name?.toLowerCase() || null,
    hasAudio: Boolean(audio)
  };
}

export async function probeVideoSourceHealth(id, organizationId) {
  const sourceRepo = RepositoryFactory.getVideoSourceRepository();
  const mediaRepo = RepositoryFactory.getMediaRepository();
  const stationRepo = RepositoryFactory.getStationRepository();

  const source = await sourceRepo.findSourceById(id, organizationId, { includeEncryptedSecret: true });
  if (!source) return null;

  try {
    if (source.sourceType === 'UPLOADED_FILE' || source.sourceType === 'MOVIE') {
      const asset = source.mediaAssetId ? await mediaRepo.findAssetById(source.mediaAssetId, organizationId) : null;
      if (!asset || asset.processingStatus !== MEDIA_PROCESSING_STATUS.READY) {
        throw new Error('Linked media asset is unavailable or not READY');
      }
      const filePath = mediaStorage.resolveKeyPath(asset.storageKey);
      const info = await mediaStorage.verifyNoSymlink(filePath);
      if (!info || !info.isFile()) throw new Error('Media file is missing on storage volume');

      return await sourceRepo.updateSourceProbeState(id, organizationId, {
        connectionStatus: VIDEO_SOURCE_CONNECTION_STATUS.ONLINE,
        availabilityStatus: VIDEO_SOURCE_AVAILABILITY.AVAILABLE,
        width: asset.width,
        height: asset.height,
        frameRate: asset.frameRate,
        videoCodec: asset.videoCodec,
        audioCodec: asset.audioCodec,
        hasAudio: asset.hasAudio,
        previewThumbnailKey: asset.thumbnailKey,
        lastConnectedAt: new Date().toISOString(),
        lastError: null,
        retryCount: 0
      });
    }

    if (source.sourceType === 'PLAYLIST') {
      const playlists = await mediaRepo.listPlaylists(organizationId, { kind: 'VIDEO' });
      const playlist = playlists.find(p => p.id === source.playlistId);
      if (!playlist || !playlist.items?.length) throw new Error('Linked video playlist is missing or empty');
      const firstAsset = await mediaRepo.findAssetById(playlist.items[0].assetId, organizationId);
      if (!firstAsset || firstAsset.processingStatus !== MEDIA_PROCESSING_STATUS.READY) {
        throw new Error('First playlist asset is unavailable');
      }
      return await sourceRepo.updateSourceProbeState(id, organizationId, {
        connectionStatus: VIDEO_SOURCE_CONNECTION_STATUS.ONLINE,
        availabilityStatus: VIDEO_SOURCE_AVAILABILITY.AVAILABLE,
        width: firstAsset.width,
        height: firstAsset.height,
        frameRate: firstAsset.frameRate,
        videoCodec: firstAsset.videoCodec,
        audioCodec: firstAsset.audioCodec,
        hasAudio: firstAsset.hasAudio,
        previewThumbnailKey: firstAsset.thumbnailKey,
        lastConnectedAt: new Date().toISOString(),
        lastError: null,
        retryCount: 0
      });
    }

    if (source.sourceType === 'OBS_LIVE') {
      const station = source.stationId ? await stationRepo.findById(source.stationId, organizationId) : null;
      if (!station) throw new Error('Assigned OBS station was not found');
      const connected = agentGateway.isAgentOnline(station.id) || station.status === 'ONLINE';
      if (!connected) throw new Error('OBS station Agent is offline');
      return await sourceRepo.updateSourceProbeState(id, organizationId, {
        connectionStatus: VIDEO_SOURCE_CONNECTION_STATUS.ONLINE,
        availabilityStatus: VIDEO_SOURCE_AVAILABILITY.AVAILABLE,
        width: 1920,
        height: 1080,
        frameRate: station.fps || 25,
        videoCodec: 'h264',
        audioCodec: 'aac',
        hasAudio: true,
        lastConnectedAt: new Date().toISOString(),
        lastError: null,
        retryCount: 0
      });
    }

    if (source.sourceType === 'SERVER_FILE') {
      const { resolvedPath } = await mediaStorage.resolveImportSource(source.serverFilePath);
      const probed = await probeStreamOrFileWithFfprobe(resolvedPath);
      return await sourceRepo.updateSourceProbeState(id, organizationId, {
        connectionStatus: VIDEO_SOURCE_CONNECTION_STATUS.ONLINE,
        availabilityStatus: VIDEO_SOURCE_AVAILABILITY.AVAILABLE,
        ...probed,
        lastConnectedAt: new Date().toISOString(),
        lastError: null,
        retryCount: 0
      });
    }

    // Network stream types (HLS_STREAM, RTMP_STREAM, SRT_STREAM, RTSP_STREAM, REMOTE_VIDEO_URL):
    // Re-validate destination at connection time (DNS rebinding & SSRF check)
    const validatedUrl = await validateVideoSourceUrl(source.sourceType, source.streamUrl);
    const probed = await probeStreamOrFileWithFfprobe(validatedUrl);
    return await sourceRepo.updateSourceProbeState(id, organizationId, {
      connectionStatus: VIDEO_SOURCE_CONNECTION_STATUS.ONLINE,
      availabilityStatus: VIDEO_SOURCE_AVAILABILITY.AVAILABLE,
      ...probed,
      lastConnectedAt: new Date().toISOString(),
      lastError: null,
      retryCount: 0
    });
  } catch (error) {
    const nextRetry = (source.retryCount || 0) + 1;
    const exhaustedRetries = !source.reconnectEnabled || nextRetry >= (source.maxRetries || 5);
    const hasConfiguredFallback = Boolean(source.fallbackSourceId || source.fallbackAssetId || source.fallbackMode === 'SLATE');
    const connectionStatus = exhaustedRetries
      ? VIDEO_SOURCE_CONNECTION_STATUS.ERROR
      : VIDEO_SOURCE_CONNECTION_STATUS.RECONNECTING;
    const availabilityStatus = exhaustedRetries && hasConfiguredFallback
      ? VIDEO_SOURCE_AVAILABILITY.FALLBACK_ACTIVE
      : VIDEO_SOURCE_AVAILABILITY.UNAVAILABLE;
    const nextBackoffMs = computeReconnectBackoffMs(nextRetry, source.backoffBaseMs, source.backoffMaxMs);
    const sanitizedError = String(error.message || 'Source health probe failed')
      .replace(/[A-Za-z]:\\[^\s"']+/g, '[local-path]')
      .slice(0, 400);

    const updated = await sourceRepo.updateSourceProbeState(id, organizationId, {
      connectionStatus,
      availabilityStatus,
      lastError: `${sanitizedError} (retry ${nextRetry}/${source.maxRetries}, backoff ${nextBackoffMs}ms)`,
      retryCount: nextRetry
    });
    return {
      ...updated,
      nextBackoffMs,
      exhaustedRetries
    };
  }
}
