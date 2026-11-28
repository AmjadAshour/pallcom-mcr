import { execFile } from 'node:child_process';
import { open, readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { MEDIA_BROADCAST_COMPATIBILITY, MEDIA_PROCESSING_STATUS } from '@mcr/shared';
import { env } from '../../config/env.js';
import { RepositoryFactory } from '../repositories/repository-factory.js';
import { mediaStorage } from './storage-manager.js';

const runFile = promisify(execFile);

const SUPPORTED_VIDEO_CODECS = new Set(['h264', 'hevc', 'vp8', 'vp9', 'av1', 'mpeg2video', 'mpeg4']);
const SUPPORTED_AUDIO_CODECS = new Set([
  'aac', 'mp3', 'opus', 'vorbis', 'flac', 'ac3', 'eac3',
  'pcm_s16le', 'pcm_s24le', 'pcm_s32le', 'pcm_f32le', 'pcm_u8'
]);
const IMAGE_CATEGORIES = new Set(['IMAGES', 'CHANNEL_LOGOS', 'GRAPHICS']);
const AUDIO_CATEGORIES = new Set(['MUSIC', 'AUDIO_RECORDINGS']);

function childEnvironment() {
  return Object.fromEntries(
    Object.entries(process.env).filter(([name]) =>
      /^(path|systemroot|windir|temp|tmp|lang|ld_library_path)$/i.test(name)
    )
  );
}

export async function sniffMagicSignature(filePath) {
  const handle = await open(filePath, 'r');
  try {
    const header = Buffer.alloc(2048);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    if (bytesRead < 4) return null;
    const buf = header.subarray(0, bytesRead);

    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (bytesRead >= 8 && buf.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') {
      return { family: 'IMAGE', container: 'png', mimeType: 'image/png' };
    }
    // JPEG: FF D8 FF
    if (bytesRead >= 3 && buf.subarray(0, 3).toString('hex') === 'ffd8ff') {
      return { family: 'IMAGE', container: 'jpeg', mimeType: 'image/jpeg' };
    }
    // RIFF (WebP, WAV, AVI)
    if (bytesRead >= 12 && buf.toString('ascii', 0, 4) === 'RIFF') {
      const form = buf.toString('ascii', 8, 12);
      if (form === 'WEBP') return { family: 'IMAGE', container: 'webp', mimeType: 'image/webp' };
      if (form === 'WAVE') return { family: 'AUDIO', container: 'wav', mimeType: 'audio/wav' };
      if (form === 'AVI ') return { family: 'VIDEO', container: 'avi', mimeType: 'video/x-msvideo' };
    }
    // ISO BMFF (MP4, MOV, M4A): box 'ftyp', 'moov', 'wide', 'mdat', 'free'
    if (bytesRead >= 12) {
      const box = buf.toString('ascii', 4, 8);
      if (['ftyp', 'moov', 'wide', 'mdat', 'free'].includes(box)) {
        const brand = box === 'ftyp' ? buf.toString('ascii', 8, 12) : '';
        if (brand === 'M4A ' || brand === 'M4B ') {
          return { family: 'AUDIO', container: 'm4a', mimeType: 'audio/mp4' };
        }
        if (brand === 'qt  ') {
          return { family: 'VIDEO', container: 'mov', mimeType: 'video/quicktime' };
        }
        return { family: 'VIDEO', container: 'mp4', mimeType: 'video/mp4' };
      }
    }
    // EBML (MKV / WebM): 1A 45 DF A3
    if (bytesRead >= 4 && buf.subarray(0, 4).toString('hex') === '1a45dfa3') {
      const ascii = buf.toString('ascii', 0, Math.min(bytesRead, 128)).toLowerCase();
      if (ascii.includes('webm')) return { family: 'VIDEO', container: 'webm', mimeType: 'video/webm' };
      return { family: 'VIDEO', container: 'mkv', mimeType: 'video/x-matroska' };
    }
    // Ogg: 'OggS'
    if (bytesRead >= 4 && buf.toString('ascii', 0, 4) === 'OggS') {
      return { family: 'AUDIO', container: 'ogg', mimeType: 'audio/ogg' };
    }
    // FLAC: 'fLaC'
    if (bytesRead >= 4 && buf.toString('ascii', 0, 4) === 'fLaC') {
      return { family: 'AUDIO', container: 'flac', mimeType: 'audio/flac' };
    }
    // ID3v2 MP3 or ADTS/MPEG audio sync
    if (bytesRead >= 3 && buf.toString('ascii', 0, 3) === 'ID3') {
      return { family: 'AUDIO', container: 'mp3', mimeType: 'audio/mpeg' };
    }
    if (bytesRead >= 2 && buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) {
      const layer = (buf[1] >> 1) & 0x03;
      if (layer === 0) return { family: 'AUDIO', container: 'aac', mimeType: 'audio/aac' };
      return { family: 'AUDIO', container: 'mp3', mimeType: 'audio/mpeg' };
    }
    // MPEG-TS: 0x47 sync byte (at 0, or 0 and 188, or 192-byte M2TS)
    if (buf[0] === 0x47 && (bytesRead < 189 || buf[188] === 0x47)) {
      return { family: 'VIDEO', container: 'mpegts', mimeType: 'video/mp2t' };
    }
    if (bytesRead >= 197 && buf[4] === 0x47 && buf[196] === 0x47) {
      return { family: 'VIDEO', container: 'mpegts', mimeType: 'video/mp2t' };
    }
    return null;
  } finally {
    await handle.close();
  }
}

function parseFrameRate(rateStr) {
  if (!rateStr || typeof rateStr !== 'string') return null;
  const [num, den] = rateStr.split('/').map(Number);
  if (!Number.isFinite(num) || !num) return null;
  if (den === undefined) return Number(num.toFixed(3));
  if (!Number.isFinite(den) || den <= 0) return null;
  return Number((num / den).toFixed(3));
}

async function inspectImageFile(filePath, signature, asset) {
  if (AUDIO_CATEGORIES.has(asset.category)) {
    return {
      quarantined: true,
      errorReason: 'Uploaded file is an image, which is not valid for an audio category.'
    };
  }
  try {
    const bytes = await readFile(filePath);
    const decoder = sharp(bytes, { limitInputPixels: 8192 * 8192, failOn: 'warning' });
    const meta = await decoder.metadata();
    if (!meta.width || !meta.height || (meta.pages ?? 1) !== 1 || !['png', 'jpeg', 'webp'].includes(meta.format)) {
      return {
        quarantined: true,
        errorReason: 'Image is corrupted, animated, or exceeds safe dimensions.'
      };
    }
    const thumbKey = mediaStorage.createStorageKey('thumbnails', asset.organizationId, asset.id, 'jpg');
    const thumbPath = await mediaStorage.ensureKeyParent(thumbKey);
    await decoder
      .rotate()
      .resize(480, 270, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toFile(thumbPath);

    return {
      kind: 'IMAGE',
      mimeType: `image/${meta.format}`,
      containerFormat: meta.format,
      width: meta.width,
      height: meta.height,
      hasVideo: false,
      hasAudio: false,
      thumbnailKey: thumbKey,
      previewKey: asset.storageKey,
      processingStatus: MEDIA_PROCESSING_STATUS.READY,
      broadcastCompatibility: MEDIA_BROADCAST_COMPATIBILITY.DIRECT_PLAYBACK,
      compatibilityNotes: ['Validated single-frame image compatible with graphics and browser preview.'],
      errorReason: null
    };
  } catch {
    return {
      quarantined: false,
      failed: true,
      errorReason: 'Image decoding failed validation.'
    };
  }
}

async function inspectAvFile(filePath, signature, asset) {
  if (IMAGE_CATEGORIES.has(asset.category)) {
    return {
      quarantined: true,
      errorReason: 'Audio/video containers are not allowed in image or logo categories.'
    };
  }
  const ffprobeBin = process.env.FFPROBE_PATH || 'ffprobe';
  let probeJson;
  try {
    const { stdout } = await runFile(
      ffprobeBin,
      [
        '-v', 'error',
        '-print_format', 'json',
        '-show_format',
        '-show_streams',
        filePath
      ],
      {
        env: childEnvironment(),
        windowsHide: true,
        timeout: Math.min(30000, env.MEDIA_PROCESSING_TIMEOUT_MS),
        maxBuffer: 2 * 1024 * 1024
      }
    );
    probeJson = JSON.parse(stdout);
  } catch {
    return {
      failed: true,
      errorReason: 'Media container structure is corrupted or unreadable by FFprobe.'
    };
  }

  const streams = Array.isArray(probeJson?.streams) ? probeJson.streams : [];
  const format = probeJson?.format || {};
  const videoStream = streams.find(s => s.codec_type === 'video' && s.disposition?.attached_pic !== 1);
  const audioStream = streams.find(s => s.codec_type === 'audio');

  if (!videoStream && !audioStream) {
    return {
      failed: true,
      errorReason: 'Media file contains neither a decodable video stream nor an audio stream.'
    };
  }

  const durationRaw = Number(format.duration ?? videoStream?.duration ?? audioStream?.duration ?? 0);
  if (!Number.isFinite(durationRaw) || durationRaw <= 0.05) {
    return {
      failed: true,
      errorReason: 'Media file has zero or invalid duration.'
    };
  }
  if (durationRaw > env.MEDIA_MAX_DURATION_SECONDS) {
    return {
      failed: true,
      errorReason: `Media duration (${Math.round(durationRaw)}s) exceeds the configured limit (${env.MEDIA_MAX_DURATION_SECONDS}s).`
    };
  }

  const videoCodec = videoStream?.codec_name?.toLowerCase() || null;
  const audioCodec = audioStream?.codec_name?.toLowerCase() || null;
  if (videoCodec && !SUPPORTED_VIDEO_CODECS.has(videoCodec)) {
    return {
      quarantined: true,
      errorReason: `Unsupported video codec (${videoCodec}).`
    };
  }
  if (audioCodec && !SUPPORTED_AUDIO_CODECS.has(audioCodec)) {
    return {
      quarantined: true,
      errorReason: `Unsupported audio codec (${audioCodec}).`
    };
  }

  const isVideo = Boolean(videoStream);
  if (!isVideo && !AUDIO_CATEGORIES.has(asset.category) && !['ADVERTISEMENTS', 'FALLBACK'].includes(asset.category)) {
    // Still allow audio files if categorized appropriately, or mark kind as AUDIO
  }
  if (isVideo && AUDIO_CATEGORIES.has(asset.category)) {
    return {
      quarantined: true,
      errorReason: 'Video stream detected in an audio-only category.'
    };
  }

  // Verify actual decode of the beginning of the media stream to detect truncated/corrupted frames
  const ffmpegBin = process.env.FFMPEG_PATH || 'ffmpeg';
  try {
    await runFile(
      ffmpegBin,
      [
        '-nostdin',
        '-v', 'error',
        '-threads', '1',
        '-t', '1',
        '-i', filePath,
        '-f', 'null',
        '-'
      ],
      {
        env: childEnvironment(),
        windowsHide: true,
        timeout: Math.min(30000, env.MEDIA_PROCESSING_TIMEOUT_MS),
        maxBuffer: 256 * 1024
      }
    );
  } catch {
    return {
      failed: true,
      errorReason: 'Media stream failed frame/sample decode verification (corrupted payload).'
    };
  }

  const width = videoStream?.width ? Number(videoStream.width) : null;
  const height = videoStream?.height ? Number(videoStream.height) : null;
  const frameRate = videoStream ? (parseFrameRate(videoStream.avg_frame_rate) || parseFrameRate(videoStream.r_frame_rate)) : null;
  const bitrateBps = Number(format.bit_rate ?? videoStream?.bit_rate ?? audioStream?.bit_rate ?? 0) || null;
  const audioChannels = audioStream?.channels ? Number(audioStream.channels) : null;
  const sampleRateHz = audioStream?.sample_rate ? Number(audioStream.sample_rate) : null;
  const formatNames = String(format.format_name || signature.container).toLowerCase();
  const primaryContainer = signature.container;

  let thumbnailKey = null;
  if (isVideo) {
    try {
      const candidateThumbKey = mediaStorage.createStorageKey('thumbnails', asset.organizationId, asset.id, 'jpg');
      const thumbPath = await mediaStorage.ensureKeyParent(candidateThumbKey);
      const seekSeconds = Math.min(1, Math.max(0, durationRaw * 0.1)).toFixed(2);
      await runFile(
        ffmpegBin,
        [
          '-nostdin',
          '-v', 'error',
          '-threads', '1',
          '-ss', seekSeconds,
          '-i', filePath,
          '-frames:v', '1',
          '-vf', 'scale=480:270:force_original_aspect_ratio=decrease',
          '-q:v', '5',
          '-y',
          thumbPath
        ],
        {
          env: childEnvironment(),
          windowsHide: true,
          timeout: Math.min(30000, env.MEDIA_PROCESSING_TIMEOUT_MS),
          maxBuffer: 256 * 1024
        }
      );
      thumbnailKey = candidateThumbKey;
    } catch {
      // Thumbnail generation failure does not invalidate a decodable video stream.
    }
  }

  const notes = [];
  let compatibility = MEDIA_BROADCAST_COMPATIBILITY.DIRECT_PLAYBACK;

  if (isVideo) {
    const isH264 = videoCodec === 'h264';
    const isAacOrSilent = !audioCodec || audioCodec === 'aac';
    const isMp4OrTs = ['mp4', 'mpegts', 'mov'].includes(primaryContainer);
    const isFullHd = width === 1920 && height === 1080;

    if (isH264 && isAacOrSilent && isMp4OrTs) {
      compatibility = MEDIA_BROADCAST_COMPATIBILITY.DIRECT_PLAYBACK;
      notes.push('H.264/AAC stream is directly compatible with broadcast playout.');
    } else if (isH264 && isAacOrSilent && !isMp4OrTs) {
      compatibility = MEDIA_BROADCAST_COMPATIBILITY.REMUX_REQUIRED;
      notes.push(`Container (${primaryContainer}) contains H.264/AAC and can be remuxed without video re-encoding.`);
    } else {
      compatibility = MEDIA_BROADCAST_COMPATIBILITY.TRANSCODE_REQUIRED;
      notes.push(`Source codec (${videoCodec}${audioCodec ? '/' + audioCodec : ''}) requires transcoding to H.264/AAC.`);
    }

    if (isFullHd) {
      notes.push('Native Full HD 1920x1080 resolution.');
    } else if (width && height) {
      notes.push(`Resolution ${width}x${height} will be scaled/padded to channel output canvas (1920x1080 Full HD / 1280x720).`);
    }
    if (!audioStream) {
      notes.push('Silent video stream (no embedded audio track).');
    }
  } else {
    if (['aac', 'mp3', 'm4a'].includes(primaryContainer) || ['aac', 'mp3'].includes(audioCodec)) {
      compatibility = MEDIA_BROADCAST_COMPATIBILITY.DIRECT_PLAYBACK;
      notes.push('Audio stream is ready for direct independent audio playback and browser preview.');
    } else {
      compatibility = MEDIA_BROADCAST_COMPATIBILITY.TRANSCODE_REQUIRED;
      notes.push(`Audio format (${primaryContainer}/${audioCodec}) is validated and marked for AAC/PCM normalization.`);
    }
  }

  const mimeMap = {
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    mkv: 'video/x-matroska',
    webm: 'video/webm',
    avi: 'video/x-msvideo',
    mpegts: 'video/mp2t',
    mp3: 'audio/mpeg',
    aac: 'audio/aac',
    m4a: 'audio/mp4',
    wav: 'audio/wav',
    flac: 'audio/flac',
    ogg: 'audio/ogg'
  };

  return {
    kind: isVideo ? 'VIDEO' : 'AUDIO',
    mimeType: mimeMap[primaryContainer] || (isVideo ? 'video/mp4' : 'audio/mpeg'),
    containerFormat: primaryContainer || formatNames.split(',')[0],
    videoCodec,
    audioCodec,
    width,
    height,
    frameRate,
    durationSeconds: Number(durationRaw.toFixed(3)),
    bitrateBps,
    audioChannels,
    sampleRateHz,
    hasVideo: isVideo,
    hasAudio: Boolean(audioStream),
    thumbnailKey,
    previewKey: asset.storageKey,
    processingStatus: MEDIA_PROCESSING_STATUS.READY,
    broadcastCompatibility: compatibility,
    compatibilityNotes: notes,
    errorReason: null
  };
}

class MediaProcessingQueue {
  constructor() {
    this.queue = [];
    this.activeCount = 0;
    this.scheduled = false;
  }

  enqueue(assetId, organizationId) {
    if (!this.queue.some(item => item.assetId === assetId)) {
      this.queue.push({ assetId, organizationId });
    }
    this._schedule();
  }

  _schedule() {
    if (this.scheduled) return;
    this.scheduled = true;
    setImmediate(() => {
      this.scheduled = false;
      void this._drain();
    });
  }

  async _drain() {
    while (this.activeCount < env.MEDIA_MAX_PROCESSING_JOBS && this.queue.length > 0) {
      const next = this.queue.shift();
      this.activeCount++;
      void this._processOne(next.assetId, next.organizationId).finally(() => {
        this.activeCount--;
        if (this.queue.length > 0) this._schedule();
      });
    }
  }

  async _processOne(assetId, organizationId) {
    const repo = RepositoryFactory.getMediaRepository();
    const asset = await repo.findAssetById(assetId, organizationId);
    if (!asset) return;

    try {
      await repo.updateAssetProcessing(assetId, organizationId, {
        processingStatus: MEDIA_PROCESSING_STATUS.VALIDATING,
        jobStatus: 'VALIDATING'
      });

      const filePath = mediaStorage.resolveKeyPath(asset.storageKey);
      await mediaStorage.verifyNoSymlink(filePath);
      const signature = await sniffMagicSignature(filePath);

      if (!signature) {
        const quarantineKey = mediaStorage.createStorageKey('quarantine', organizationId, assetId, 'bin');
        await mediaStorage.promoteKey(asset.storageKey, quarantineKey).catch(() => {});
        await repo.updateAssetProcessing(assetId, organizationId, {
          storageKey: quarantineKey,
          processingStatus: MEDIA_PROCESSING_STATUS.QUARANTINED,
          broadcastCompatibility: MEDIA_BROADCAST_COMPATIBILITY.UNSUPPORTED,
          compatibilityNotes: ['Unrecognized or unsafe binary file signature.'],
          errorReason: 'File signature does not match any supported video, audio, or image container.',
          jobStatus: 'QUARANTINED'
        });
        return;
      }

      await repo.updateAssetProcessing(assetId, organizationId, {
        processingStatus: MEDIA_PROCESSING_STATUS.PROCESSING,
        jobStatus: 'PROCESSING'
      });

      const outcome = signature.family === 'IMAGE'
        ? await inspectImageFile(filePath, signature, asset)
        : await inspectAvFile(filePath, signature, asset);

      if (outcome.quarantined) {
        const quarantineKey = mediaStorage.createStorageKey('quarantine', organizationId, assetId, 'bin');
        await mediaStorage.promoteKey(asset.storageKey, quarantineKey).catch(() => {});
        await repo.updateAssetProcessing(assetId, organizationId, {
          storageKey: quarantineKey,
          processingStatus: MEDIA_PROCESSING_STATUS.QUARANTINED,
          broadcastCompatibility: MEDIA_BROADCAST_COMPATIBILITY.UNSUPPORTED,
          compatibilityNotes: [outcome.errorReason],
          errorReason: outcome.errorReason,
          jobStatus: 'QUARANTINED'
        });
        return;
      }

      if (outcome.failed) {
        await repo.updateAssetProcessing(assetId, organizationId, {
          processingStatus: MEDIA_PROCESSING_STATUS.FAILED,
          broadcastCompatibility: MEDIA_BROADCAST_COMPATIBILITY.UNSUPPORTED,
          compatibilityNotes: [outcome.errorReason],
          errorReason: outcome.errorReason,
          jobStatus: 'FAILED'
        });
        return;
      }

      await repo.updateAssetProcessing(assetId, organizationId, {
        ...outcome,
        jobStatus: 'READY'
      });
    } catch {
      await repo.updateAssetProcessing(assetId, organizationId, {
        processingStatus: MEDIA_PROCESSING_STATUS.FAILED,
        broadcastCompatibility: MEDIA_BROADCAST_COMPATIBILITY.UNSUPPORTED,
        errorReason: 'Media validation worker encountered an unexpected processing error.',
        jobStatus: 'FAILED'
      }).catch(() => {});
    }
  }

  async recoverInterruptedJobs() {
    try {
      const repo = RepositoryFactory.getMediaRepository();
      const db = repo.db;
      const pendingRows = db.prepare(
        "SELECT id, organizationId FROM media_assets WHERE processingStatus IN ('UPLOADED', 'VALIDATING', 'PROCESSING') ORDER BY createdAt ASC LIMIT 100"
      ).all();
      for (const row of pendingRows) {
        this.enqueue(row.id, row.organizationId);
      }
    } catch {
      // Ignore if database is not yet initialized.
    }
  }
}

export const mediaProcessingQueue = new MediaProcessingQueue();
