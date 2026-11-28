import { createHash, randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { copyFile, open, stat } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import { isIPv4 } from 'node:net';
import { MEDIA_BROADCAST_COMPATIBILITY, MEDIA_PROCESSING_STATUS, MEDIA_UPLOAD_STATUS } from '@mcr/shared';
import { env } from '../../config/env.js';
import { isPublicIPv4, isPublicSourceHostname } from '../program/input-config.js';
import { RepositoryFactory } from '../repositories/repository-factory.js';
import { mediaProcessingQueue } from './media-processor.js';
import { mediaStorage, sanitizeDisplayFilename } from './storage-manager.js';

const activeChunkUploads = new Set();

export function activeUploadStreamCount() {
  return activeChunkUploads.size;
}

export async function cleanupExpiredUploadSessions() {
  const repo = RepositoryFactory.getMediaRepository();
  const expired = await repo.expireAbandonedUploads(Date.now());
  for (const session of expired) {
    await mediaStorage.removeKey(session.uploadKey).catch(() => {});
  }
  return expired.length;
}

export async function initiateResumableUpload({
  organizationId,
  userId,
  ipAddress,
  title,
  description = '',
  folder = '',
  category,
  tags = [],
  channelIds = [],
  originalFilename,
  declaredMimeType = '',
  expectedSizeBytes,
  expectedChecksumSha256 = null
}) {
  if (expectedSizeBytes <= 0 || expectedSizeBytes > env.MEDIA_MAX_FILE_SIZE_BYTES) {
    throw Object.assign(
      new Error(`File size exceeds the configured maximum limit (${Math.round(env.MEDIA_MAX_FILE_SIZE_BYTES / (1024 ** 2))} MiB)`),
      { statusCode: 413 }
    );
  }
  await cleanupExpiredUploadSessions();
  await mediaStorage.assertDiskHeadroom(expectedSizeBytes);

  const id = randomUUID();
  const uploadKey = mediaStorage.createStorageKey('uploads', organizationId, id, 'part');
  const uploadPath = await mediaStorage.ensureKeyParent(uploadKey);
  const handle = await open(uploadPath, 'wx', 0o600);
  await handle.close();

  const chunkSizeBytes = Math.min(env.MEDIA_CHUNK_MAX_BYTES, 8 * 1024 * 1024);
  const expiresAt = Date.now() + env.MEDIA_UPLOAD_TTL_MS;
  const safeFilename = sanitizeDisplayFilename(originalFilename);
  const repo = RepositoryFactory.getMediaRepository();

  try {
    return await repo.createUploadSession({
      id,
      organizationId,
      createdByUserId: userId,
      title: title.trim(),
      description: description.trim(),
      folder: folder.trim(),
      category,
      tags,
      channelIds,
      originalFilename: safeFilename,
      declaredMimeType: declaredMimeType.trim().slice(0, 120),
      expectedSizeBytes,
      expectedChecksumSha256: expectedChecksumSha256 ? expectedChecksumSha256.toLowerCase() : null,
      chunkSizeBytes,
      uploadKey,
      expiresAt
    }, { id: userId, ipAddress });
  } catch (error) {
    await mediaStorage.removeKey(uploadKey).catch(() => {});
    throw error;
  }
}

export async function getResumableUploadStatus(sessionId, organizationId) {
  await cleanupExpiredUploadSessions();
  const repo = RepositoryFactory.getMediaRepository();
  const session = await repo.findUploadSession(sessionId, organizationId);
  if (!session) return null;
  if (session.status === MEDIA_UPLOAD_STATUS.UPLOADING) {
    const filePath = mediaStorage.resolveKeyPath(session.uploadKey);
    const info = await stat(filePath).catch(() => null);
    const actualBytes = info ? info.size : 0;
    if (actualBytes !== session.receivedBytes) {
      return await repo.updateUploadSessionProgress(sessionId, organizationId, {
        receivedBytes: actualBytes
      });
    }
  }
  return session;
}

export async function streamUploadChunk({
  sessionId,
  organizationId,
  offset,
  contentLength,
  expectedChunkSha256 = null,
  requestStream
}) {
  if (activeChunkUploads.has(sessionId)) {
    throw Object.assign(new Error('Another chunk write or finalization is already in progress for this upload session'), { statusCode: 409 });
  }
  if (activeChunkUploads.size >= env.MEDIA_MAX_CONCURRENT_UPLOADS) {
    throw Object.assign(new Error('Maximum concurrent media upload streams reached; retry shortly'), { statusCode: 429 });
  }

  activeChunkUploads.add(sessionId);
  try {
    const repo = RepositoryFactory.getMediaRepository();
    const session = await repo.findUploadSession(sessionId, organizationId);
    if (!session) {
      throw Object.assign(new Error('Upload session not found'), { statusCode: 404 });
    }
    if (session.status !== MEDIA_UPLOAD_STATUS.UPLOADING) {
      throw Object.assign(new Error(`Upload session is not active (status: ${session.status})`), { statusCode: 409 });
    }
    if (session.expiresAt <= Date.now()) {
      await repo.updateUploadSessionProgress(sessionId, organizationId, { status: MEDIA_UPLOAD_STATUS.EXPIRED });
      await mediaStorage.removeKey(session.uploadKey).catch(() => {});
      throw Object.assign(new Error('Upload session has expired'), { statusCode: 410 });
    }

    const filePath = mediaStorage.resolveKeyPath(session.uploadKey);
    const info = await mediaStorage.verifyNoSymlink(filePath);
    const currentBytes = info ? info.size : 0;

    // Duplicate chunk protection & offset verification
    if (!Number.isInteger(offset) || offset < 0) {
      throw Object.assign(new Error('Invalid Upload-Offset header'), { statusCode: 400 });
    }
    if (offset !== currentBytes) {
      throw Object.assign(
        new Error(`Upload offset mismatch: server has ${currentBytes} bytes, client sent offset ${offset}`),
        { statusCode: 409, details: { receivedBytes: currentBytes, expectedSizeBytes: session.expectedSizeBytes } }
      );
    }

    const remaining = session.expectedSizeBytes - currentBytes;
    if (remaining <= 0) {
      return await repo.updateUploadSessionProgress(sessionId, organizationId, { receivedBytes: currentBytes });
    }
    if (contentLength !== undefined && (contentLength <= 0 || contentLength > env.MEDIA_CHUNK_MAX_BYTES || contentLength > remaining)) {
      throw Object.assign(
        new Error(`Chunk size must be between 1 and ${Math.min(env.MEDIA_CHUNK_MAX_BYTES, remaining)} bytes`),
        { statusCode: 413 }
      );
    }

    await mediaStorage.assertDiskHeadroom(Math.min(remaining, env.MEDIA_CHUNK_MAX_BYTES));

    const handle = await open(filePath, 'r+');
    let written = 0;
    const chunkHash = expectedChunkSha256 ? createHash('sha256') : null;
    try {
      for await (const buffer of requestStream.iterator({ destroyOnReturn: false })) {
        if (written + buffer.length > env.MEDIA_CHUNK_MAX_BYTES || currentBytes + written + buffer.length > session.expectedSizeBytes) {
          await handle.truncate(currentBytes);
          throw Object.assign(new Error('Chunk exceeds maximum chunk size or declared file size'), { statusCode: 413 });
        }
        await handle.write(buffer, 0, buffer.length, currentBytes + written);
        if (chunkHash) chunkHash.update(buffer);
        written += buffer.length;
      }

      if (written === 0) {
        throw Object.assign(new Error('Empty upload chunk payload'), { statusCode: 400 });
      }
      if (contentLength !== undefined && written !== contentLength) {
        await handle.truncate(currentBytes);
        throw Object.assign(new Error('Incomplete chunk transfer; rolled back to previous offset'), { statusCode: 400 });
      }
      if (chunkHash && chunkHash.digest('hex') !== expectedChunkSha256.toLowerCase()) {
        await handle.truncate(currentBytes);
        throw Object.assign(new Error('Chunk SHA-256 checksum mismatch; rolled back chunk'), { statusCode: 400 });
      }
    } catch (error) {
      await handle.truncate(currentBytes).catch(() => {});
      throw error;
    } finally {
      await handle.close();
    }

    const newReceivedBytes = currentBytes + written;
    return await repo.updateUploadSessionProgress(sessionId, organizationId, {
      receivedBytes: newReceivedBytes
    });
  } finally {
    activeChunkUploads.delete(sessionId);
  }
}

export async function completeResumableUpload({
  sessionId,
  organizationId,
  userId,
  ipAddress,
  expectedChecksumSha256 = null
}) {
  if (activeChunkUploads.has(sessionId)) {
    throw Object.assign(new Error('Upload session is currently busy'), { statusCode: 409 });
  }
  activeChunkUploads.add(sessionId);
  try {
    const repo = RepositoryFactory.getMediaRepository();
    const session = await repo.findUploadSession(sessionId, organizationId);
    if (!session) {
      throw Object.assign(new Error('Upload session not found'), { statusCode: 404 });
    }
    if (session.status === MEDIA_UPLOAD_STATUS.UPLOADED && session.assetId) {
      throw Object.assign(new Error('Upload session has already been finalized'), { statusCode: 409 });
    }
    if (session.status !== MEDIA_UPLOAD_STATUS.UPLOADING) {
      throw Object.assign(new Error(`Upload session cannot be finalized from state ${session.status}`), { statusCode: 409 });
    }

    const filePath = mediaStorage.resolveKeyPath(session.uploadKey);
    const info = await mediaStorage.verifyNoSymlink(filePath);
    if (!info || !info.isFile() || info.size !== session.expectedSizeBytes) {
      throw Object.assign(
        new Error(`Upload is incomplete (${info?.size ?? 0} of ${session.expectedSizeBytes} bytes received)`),
        { statusCode: 409 }
      );
    }

    const { checksumSha256, sizeBytes } = await mediaStorage.computeFileSha256(session.uploadKey);
    const targetChecksum = (expectedChecksumSha256 || session.expectedChecksumSha256)?.toLowerCase();
    if (targetChecksum && checksumSha256 !== targetChecksum) {
      await repo.updateUploadSessionProgress(sessionId, organizationId, {
        status: MEDIA_UPLOAD_STATUS.FAILED,
        errorReason: 'Final SHA-256 checksum mismatch'
      });
      await mediaStorage.removeKey(session.uploadKey).catch(() => {});
      throw Object.assign(new Error('Final file SHA-256 integrity verification failed'), { statusCode: 400 });
    }

    const assetId = randomUUID();
    const mediaKey = mediaStorage.createStorageKey('media', organizationId, assetId, 'bin');
    await mediaStorage.promoteKey(session.uploadKey, mediaKey);

    let asset;
    try {
      asset = await repo.createAsset({
        id: assetId,
        organizationId,
        folder: session.folder,
        title: session.title,
        description: session.description,
        category: session.category,
        kind: ['MUSIC', 'AUDIO_RECORDINGS'].includes(session.category) ? 'AUDIO'
          : ['IMAGES', 'CHANNEL_LOGOS', 'GRAPHICS'].includes(session.category) ? 'IMAGE' : 'VIDEO',
        tags: session.tags,
        channelIds: session.channelIds,
        originalFilename: session.originalFilename,
        storageKey: mediaKey,
        sizeBytes,
        checksumSha256,
        mimeType: session.declaredMimeType || 'application/octet-stream',
        uploadStatus: MEDIA_UPLOAD_STATUS.UPLOADED,
        processingStatus: MEDIA_PROCESSING_STATUS.VALIDATING,
        broadcastCompatibility: MEDIA_BROADCAST_COMPATIBILITY.PENDING,
        createdByUserId: userId,
        importSource: 'resumable_upload',
        auditAction: 'MEDIA_UPLOAD_COMPLETED'
      }, { id: userId, ipAddress }, { sessionId, checkQuota: false });
    } catch (error) {
      await mediaStorage.removeKey(mediaKey).catch(() => {});
      throw error;
    }

    mediaProcessingQueue.enqueue(asset.id, organizationId);
    return asset;
  } finally {
    activeChunkUploads.delete(sessionId);
  }
}

export async function cancelResumableUpload({ sessionId, organizationId, userId, ipAddress }) {
  if (activeChunkUploads.has(sessionId)) {
    throw Object.assign(new Error('Cannot cancel while a chunk stream is actively writing'), { statusCode: 409 });
  }
  const repo = RepositoryFactory.getMediaRepository();
  const cancelled = await repo.cancelUploadSession(sessionId, organizationId, { id: userId, ipAddress });
  if (!cancelled) {
    throw Object.assign(new Error('Upload session not found'), { statusCode: 404 });
  }
  await mediaStorage.removeKey(cancelled.uploadKey).catch(() => {});
  return cancelled;
}

export async function importFromAuthorizedServerDirectory({
  organizationId,
  userId,
  ipAddress,
  relativeFilename,
  title,
  description = '',
  folder = '',
  category,
  tags = [],
  channelIds = []
}) {
  const { resolvedPath, sizeBytes, filename } = await mediaStorage.resolveImportSource(relativeFilename);
  if (sizeBytes <= 0 || sizeBytes > env.MEDIA_MAX_FILE_SIZE_BYTES) {
    throw Object.assign(new Error('Import file is empty or exceeds the maximum file size limit'), { statusCode: 413 });
  }
  await mediaStorage.assertDiskHeadroom(sizeBytes);

  const repo = RepositoryFactory.getMediaRepository();
  const usage = await repo.getStorageUsage(organizationId);
  if (usage.totalCommittedBytes + sizeBytes > usage.quotaBytes) {
    throw Object.assign(new Error('Import exceeds the organization media storage quota'), { statusCode: 409 });
  }

  const assetId = randomUUID();
  const mediaKey = mediaStorage.createStorageKey('media', organizationId, assetId, 'bin');
  const destPath = await mediaStorage.ensureKeyParent(mediaKey);
  await copyFile(resolvedPath, destPath);

  let asset;
  try {
    const { checksumSha256 } = await mediaStorage.computeFileSha256(mediaKey);
    asset = await repo.createAsset({
      id: assetId,
      organizationId,
      folder: folder.trim(),
      title: (title || filename).trim(),
      description: description.trim(),
      category,
      kind: ['MUSIC', 'AUDIO_RECORDINGS'].includes(category) ? 'AUDIO'
        : ['IMAGES', 'CHANNEL_LOGOS', 'GRAPHICS'].includes(category) ? 'IMAGE' : 'VIDEO',
      tags,
      channelIds,
      originalFilename: sanitizeDisplayFilename(filename),
      storageKey: mediaKey,
      sizeBytes,
      checksumSha256,
      mimeType: 'application/octet-stream',
      uploadStatus: MEDIA_UPLOAD_STATUS.UPLOADED,
      processingStatus: MEDIA_PROCESSING_STATUS.VALIDATING,
      broadcastCompatibility: MEDIA_BROADCAST_COMPATIBILITY.PENDING,
      createdByUserId: userId,
      importSource: 'server_directory',
      auditAction: 'MEDIA_SERVER_DIRECTORY_IMPORTED'
    }, { id: userId, ipAddress });
  } catch (error) {
    await mediaStorage.removeKey(mediaKey).catch(() => {});
    throw error;
  }

  mediaProcessingQueue.enqueue(asset.id, organizationId);
  return asset;
}

async function resolveSafeRemoteAddress(urlString, resolveIPv4 = null) {
  const parsed = URL.parse(urlString);
  if (!parsed || (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')) {
    throw Object.assign(new Error('Remote media import requires an explicit HTTPS URL'), { statusCode: 400 });
  }
  if (parsed.username || parsed.password || parsed.hash) {
    throw Object.assign(new Error('Remote media URL must not contain embedded credentials or fragments'), { statusCode: 400 });
  }

  const allowLocalHttpFixture = process.env.MCR_ALLOW_LOOPBACK_MEDIA_IMPORT_FOR_TESTS === '1' &&
    process.env.NODE_ENV !== 'production' &&
    parsed.hostname === '127.0.0.1';

  if (!allowLocalHttpFixture) {
    if (parsed.protocol !== 'https:') {
      throw Object.assign(new Error('Remote media import requires HTTPS'), { statusCode: 400 });
    }
    if (!isPublicSourceHostname(parsed.hostname)) {
      throw Object.assign(new Error('Remote media URL hostname is not a permitted public destination'), { statusCode: 400 });
    }
  }

  if (isIPv4(parsed.hostname)) {
    if (!allowLocalHttpFixture && !isPublicIPv4(parsed.hostname)) {
      throw Object.assign(new Error('Remote media URL IPv4 address is not a permitted public destination'), { statusCode: 400 });
    }
    return { parsed, address: parsed.hostname };
  }

  const resolver = resolveIPv4 || (async host => {
    const records = await lookup(host, { family: 4, all: true, verbatim: true });
    return records.map(r => r.address);
  });
  const addresses = await resolver(parsed.hostname).catch(() => []);
  if (!addresses.length || !addresses.every(addr => isPublicIPv4(addr))) {
    throw Object.assign(new Error('Remote media hostname resolved to a private, non-public, or invalid IPv4 address'), { statusCode: 400 });
  }
  return { parsed, address: addresses[0] };
}

export async function importFromAuthorizedRemoteUrl({
  organizationId,
  userId,
  ipAddress,
  url,
  title,
  description = '',
  folder = '',
  category,
  tags = [],
  channelIds = [],
  maxDownloadBytes = Math.min(env.MEDIA_MAX_FILE_SIZE_BYTES, 2 * 1024 ** 3),
  timeoutMs = 60000,
  resolveIPv4 = null
}) {
  const { parsed, address } = await resolveSafeRemoteAddress(url, resolveIPv4);
  await mediaStorage.assertDiskHeadroom(16 * 1024 * 1024);

  const repo = RepositoryFactory.getMediaRepository();
  const usage = await repo.getStorageUsage(organizationId);
  if (usage.remainingQuotaBytes <= 0) {
    throw Object.assign(new Error('Organization media storage quota is full'), { statusCode: 409 });
  }
  const byteCeiling = Math.min(maxDownloadBytes, usage.remainingQuotaBytes, env.MEDIA_MAX_FILE_SIZE_BYTES);

  const tempId = randomUUID();
  const tempKey = mediaStorage.createStorageKey('uploads', organizationId, tempId, 'part');
  const tempPath = await mediaStorage.ensureKeyParent(tempKey);

  const hash = createHash('sha256');
  let downloadedBytes = 0;

  try {
    const client = parsed.protocol === 'https:' ? https : http;
    await new Promise((resolve, reject) => {
      const req = client.request({
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: 'GET',
        servername: parsed.hostname,
        lookup: (_hostname, _options, callback) => callback(null, address, 4),
        timeout: timeoutMs,
        headers: {
          'User-Agent': 'PALLCOM-MCR-MediaIngest/1.0',
          Accept: '*/*'
        }
      }, async response => {
        try {
          if (response.statusCode >= 300 && response.statusCode < 400) {
            response.resume();
            reject(Object.assign(new Error('Remote URL redirects are denied for security'), { statusCode: 400 }));
            return;
          }
          if (response.statusCode !== 200) {
            response.resume();
            reject(Object.assign(new Error(`Remote server returned HTTP ${response.statusCode}`), { statusCode: 400 }));
            return;
          }
          const declaredLen = Number(response.headers['content-length']);
          if (Number.isFinite(declaredLen) && declaredLen > byteCeiling) {
            response.destroy();
            reject(Object.assign(new Error('Remote media file exceeds maximum download size or organization quota'), { statusCode: 413 }));
            return;
          }

          const handle = await open(tempPath, 'wx', 0o600);
          try {
            for await (const chunk of response) {
              downloadedBytes += chunk.length;
              if (downloadedBytes > byteCeiling) {
                throw Object.assign(new Error('Remote media stream exceeded maximum download size or organization quota'), { statusCode: 413 });
              }
              await handle.write(chunk, 0, chunk.length, downloadedBytes - chunk.length);
              hash.update(chunk);
            }
            if (downloadedBytes === 0) {
              throw Object.assign(new Error('Remote media download was empty'), { statusCode: 400 });
            }
          } finally {
            await handle.close();
          }
          resolve();
        } catch (err) {
          reject(err);
        }
      });
      req.on('timeout', () => req.destroy(Object.assign(new Error('Remote media download timed out'), { statusCode: 504 })));
      req.on('error', err => reject(err.statusCode ? err : Object.assign(new Error('Failed to download remote media'), { statusCode: 400 })));
      req.end();
    });

    const assetId = randomUUID();
    const mediaKey = mediaStorage.createStorageKey('media', organizationId, assetId, 'bin');
    await mediaStorage.promoteKey(tempKey, mediaKey);

    const urlFilename = sanitizeDisplayFilename(decodeURIComponent(parsed.pathname.split('/').pop() || 'remote-media.bin'));
    const asset = await repo.createAsset({
      id: assetId,
      organizationId,
      folder: folder.trim(),
      title: (title || urlFilename).trim(),
      description: description.trim(),
      category,
      kind: ['MUSIC', 'AUDIO_RECORDINGS'].includes(category) ? 'AUDIO'
        : ['IMAGES', 'CHANNEL_LOGOS', 'GRAPHICS'].includes(category) ? 'IMAGE' : 'VIDEO',
      tags,
      channelIds,
      originalFilename: urlFilename,
      storageKey: mediaKey,
      sizeBytes: downloadedBytes,
      checksumSha256: hash.digest('hex'),
      mimeType: 'application/octet-stream',
      uploadStatus: MEDIA_UPLOAD_STATUS.UPLOADED,
      processingStatus: MEDIA_PROCESSING_STATUS.VALIDATING,
      broadcastCompatibility: MEDIA_BROADCAST_COMPATIBILITY.PENDING,
      createdByUserId: userId,
      importSource: 'remote_url',
      auditAction: 'MEDIA_REMOTE_URL_IMPORTED'
    }, { id: userId, ipAddress });

    mediaProcessingQueue.enqueue(asset.id, organizationId);
    return asset;
  } catch (error) {
    await mediaStorage.removeKey(tempKey).catch(() => {});
    throw error;
  }
}
