import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Router } from 'express';
import { z } from 'zod';
import {
  MEDIA_BROADCAST_COMPATIBILITY,
  MEDIA_CATEGORIES,
  MEDIA_KINDS,
  MEDIA_PROCESSING_STATUS
} from '@mcr/shared';
import { env } from '../../config/env.js';
import { mediaProcessingQueue } from '../../infrastructure/media/media-processor.js';
import { mediaStorage } from '../../infrastructure/media/storage-manager.js';
import {
  activeUploadStreamCount,
  cancelResumableUpload,
  cleanupExpiredUploadSessions,
  completeResumableUpload,
  getResumableUploadStatus,
  importFromAuthorizedRemoteUrl,
  importFromAuthorizedServerDirectory,
  initiateResumableUpload,
  streamUploadChunk
} from '../../infrastructure/media/upload-service.js';
import { RepositoryFactory } from '../../infrastructure/repositories/repository-factory.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { authorize } from '../middlewares/rbac.middleware.js';
import { validateBody } from '../middlewares/validate.middleware.js';

export const mediaRouter = Router();

const titleSchema = z.string().trim().min(1).max(250);
const descriptionSchema = z.string().trim().max(2000).optional().default('');
const folderSchema = z.string().trim().max(160).regex(/^[a-zA-Z0-9_\-\s/]*$/, 'Invalid folder name').optional().default('');
const categorySchema = z.enum(MEDIA_CATEGORIES);
const tagsSchema = z.array(z.string().trim().min(1).max(60)).max(25).optional().default([]);
const channelIdsSchema = z.array(z.string().trim().min(1).max(100)).max(20).optional().default([]);
const sha256Schema = z.string().regex(/^[a-fA-F0-9]{64}$/).optional();

const initiateUploadSchema = z.object({
  title: titleSchema,
  description: descriptionSchema,
  folder: folderSchema,
  category: categorySchema,
  tags: tagsSchema,
  channelIds: channelIdsSchema,
  originalFilename: z.string().trim().min(1).max(255),
  declaredMimeType: z.string().trim().max(120).optional().default(''),
  expectedSizeBytes: z.number().int().positive(),
  expectedChecksumSha256: sha256Schema
}).strict();

const completeUploadSchema = z.object({
  expectedChecksumSha256: sha256Schema
}).strict();

const updateAssetSchema = z.object({
  title: titleSchema.optional(),
  description: z.string().trim().max(2000).optional(),
  folder: folderSchema.optional(),
  category: categorySchema.optional(),
  tags: z.array(z.string().trim().min(1).max(60)).max(25).optional(),
  channelIds: z.array(z.string().trim().min(1).max(100)).max(20).optional()
}).strict();

const directoryImportSchema = z.object({
  relativeFilename: z.string().trim().min(1).max(255),
  title: titleSchema.optional(),
  description: descriptionSchema,
  folder: folderSchema,
  category: categorySchema,
  tags: tagsSchema,
  channelIds: channelIdsSchema
}).strict();

const urlImportSchema = z.object({
  url: z.string().trim().url().max(2048),
  title: titleSchema.optional(),
  description: descriptionSchema,
  folder: folderSchema,
  category: categorySchema,
  tags: tagsSchema,
  channelIds: channelIdsSchema
}).strict();

const playlistSchema = z.object({
  name: z.string().trim().min(1).max(160),
  description: descriptionSchema,
  kind: z.enum(['VIDEO', 'AUDIO']),
  channelId: z.string().trim().max(100).optional(),
  items: z.array(z.object({
    assetId: z.string().uuid(),
    order: z.number().int().nonnegative().optional()
  }).strict()).min(1).max(200)
}).strict();

mediaRouter.use('/media', (_req, res, next) => {
  res.set({ 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' });
  next();
});

mediaRouter.get('/media/storage', authenticate, authorize('station:read'), async (req, res, next) => {
  try {
    await cleanupExpiredUploadSessions();
    const repo = RepositoryFactory.getMediaRepository();
    const [usage, disk, knownKeys] = await Promise.all([
      repo.getStorageUsage(req.user.organizationId),
      mediaStorage.getDiskSpace(),
      repo.listKnownStorageKeys(req.user.organizationId)
    ]);
    const orphans = await mediaStorage.detectOrphanedFiles(req.user.organizationId, knownKeys);
    res.json({
      success: true,
      data: {
        ...usage,
        disk,
        orphanedFilesCount: orphans.length,
        orphanedBytes: orphans.reduce((sum, item) => sum + item.sizeBytes, 0),
        activeUploadStreams: activeUploadStreamCount(),
        limits: {
          maxFileSizeBytes: env.MEDIA_MAX_FILE_SIZE_BYTES,
          maxDurationSeconds: env.MEDIA_MAX_DURATION_SECONDS,
          orgQuotaBytes: env.MEDIA_ORG_QUOTA_BYTES,
          maxConcurrentUploads: env.MEDIA_MAX_CONCURRENT_UPLOADS,
          maxProcessingJobs: env.MEDIA_MAX_PROCESSING_JOBS,
          chunkMaxBytes: env.MEDIA_CHUNK_MAX_BYTES,
          uploadSessionTtlMs: env.MEDIA_UPLOAD_TTL_MS
        }
      }
    });
  } catch (error) {
    next(error);
  }
});

mediaRouter.post('/media/storage/cleanup', authenticate, authorize('media:delete'), async (req, res, next) => {
  try {
    const expiredCount = await cleanupExpiredUploadSessions();
    const repo = RepositoryFactory.getMediaRepository();
    const knownKeys = await repo.listKnownStorageKeys(req.user.organizationId);
    const orphans = await mediaStorage.detectOrphanedFiles(req.user.organizationId, knownKeys);
    for (const orphan of orphans) {
      await mediaStorage.removeKey(orphan.storageKey).catch(() => {});
    }
    await RepositoryFactory.getAuditRepository().create({
      organizationId: req.user.organizationId,
      userId: req.user.id,
      action: 'MEDIA_STORAGE_CLEANUP',
      resourceType: 'MediaStorage',
      resourceId: req.user.organizationId,
      details: { expiredSessionsCleaned: expiredCount, orphanedFilesRemoved: orphans.length },
      ipAddress: req.ip
    });
    res.json({
      success: true,
      data: { expiredSessionsCleaned: expiredCount, orphanedFilesRemoved: orphans.length }
    });
  } catch (error) {
    next(error);
  }
});

mediaRouter.get('/media/assets', authenticate, authorize('station:read'), async (req, res, next) => {
  try {
    const page = req.query.page ? Number(req.query.page) : 1;
    const pageSize = req.query.pageSize ? Number(req.query.pageSize) : 24;
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
      return res.status(400).json({ success: false, error: 'Invalid pagination parameters' });
    }
    const category = req.query.category ? String(req.query.category) : '';
    if (category && !MEDIA_CATEGORIES.includes(category)) {
      return res.status(400).json({ success: false, error: 'Invalid media category filter' });
    }
    const kind = req.query.kind ? String(req.query.kind) : '';
    if (kind && !MEDIA_KINDS.includes(kind)) {
      return res.status(400).json({ success: false, error: 'Invalid media kind filter' });
    }
    const processingStatus = req.query.processingStatus ? String(req.query.processingStatus) : '';
    if (processingStatus && !Object.values(MEDIA_PROCESSING_STATUS).includes(processingStatus)) {
      return res.status(400).json({ success: false, error: 'Invalid processing status filter' });
    }
    const broadcastCompatibility = req.query.broadcastCompatibility ? String(req.query.broadcastCompatibility) : '';
    if (broadcastCompatibility && !Object.values(MEDIA_BROADCAST_COMPATIBILITY).includes(broadcastCompatibility)) {
      return res.status(400).json({ success: false, error: 'Invalid compatibility filter' });
    }

    const data = await RepositoryFactory.getMediaRepository().listAssets(req.user.organizationId, {
      page,
      pageSize,
      search: req.query.search ? String(req.query.search).slice(0, 120) : '',
      category,
      kind,
      folder: req.query.folder ? String(req.query.folder).slice(0, 160) : '',
      tag: req.query.tag ? String(req.query.tag).slice(0, 60) : '',
      channelId: req.query.channelId ? String(req.query.channelId).slice(0, 100) : '',
      processingStatus,
      broadcastCompatibility,
      sortBy: req.query.sortBy ? String(req.query.sortBy) : 'createdAt',
      sortOrder: req.query.sortOrder ? String(req.query.sortOrder) : 'desc'
    });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

mediaRouter.get('/media/assets/:id', authenticate, authorize('station:read'), async (req, res, next) => {
  try {
    const asset = await RepositoryFactory.getMediaRepository().findAssetById(req.params.id, req.user.organizationId);
    if (!asset) return res.status(404).json({ success: false, error: 'Media asset not found' });
    res.json({ success: true, data: asset });
  } catch (error) {
    next(error);
  }
});

mediaRouter.patch('/media/assets/:id', authenticate, authorize('media:upload'), validateBody(updateAssetSchema), async (req, res, next) => {
  try {
    const updated = await RepositoryFactory.getMediaRepository().updateAssetMetadata(
      req.params.id,
      req.user.organizationId,
      req.body,
      { id: req.user.id, ipAddress: req.ip }
    );
    if (!updated) return res.status(404).json({ success: false, error: 'Media asset not found' });
    res.json({ success: true, data: updated });
  } catch (error) {
    next(error);
  }
});

mediaRouter.post('/media/assets/:id/reprocess', authenticate, authorize('media:upload'), async (req, res, next) => {
  try {
    const asset = await RepositoryFactory.getMediaRepository().findAssetById(req.params.id, req.user.organizationId);
    if (!asset) return res.status(404).json({ success: false, error: 'Media asset not found' });
    mediaProcessingQueue.enqueue(asset.id, req.user.organizationId);
    res.json({ success: true, data: asset });
  } catch (error) {
    next(error);
  }
});

mediaRouter.get('/media/assets/:id/thumbnail', authenticate, authorize('station:read'), async (req, res, next) => {
  try {
    const asset = await RepositoryFactory.getMediaRepository().findAssetById(req.params.id, req.user.organizationId);
    if (!asset || !asset.thumbnailKey) return res.sendStatus(404);
    const filePath = mediaStorage.resolveKeyPath(asset.thumbnailKey);
    const info = await mediaStorage.verifyNoSymlink(filePath);
    if (!info || !info.isFile()) return res.sendStatus(404);
    res.set({
      'Content-Type': 'image/jpeg',
      'Content-Length': String(info.size),
      'X-Content-Type-Options': 'nosniff'
    });
    createReadStream(filePath).pipe(res);
  } catch (error) {
    next(error);
  }
});

mediaRouter.get('/media/assets/:id/preview', authenticate, authorize('station:read'), async (req, res, next) => {
  try {
    const asset = await RepositoryFactory.getMediaRepository().findAssetById(req.params.id, req.user.organizationId);
    if (!asset || asset.processingStatus !== MEDIA_PROCESSING_STATUS.READY) {
      return res.status(404).json({ success: false, error: 'Validated media preview is not available' });
    }
    const key = asset.previewKey || asset.storageKey;
    const filePath = mediaStorage.resolveKeyPath(key);
    const info = await mediaStorage.verifyNoSymlink(filePath);
    if (!info || !info.isFile()) return res.sendStatus(404);

    const total = info.size;
    const mimeType = asset.mimeType || 'application/octet-stream';
    const range = req.headers.range;

    res.set({
      'Accept-Ranges': 'bytes',
      'Content-Type': mimeType,
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': 'inline'
    });

    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match) return res.status(416).set('Content-Range', `bytes */${total}`).end();
      const start = match[1] ? Number(match[1]) : 0;
      const end = match[2] ? Number(match[2]) : total - 1;
      if (start >= total || end >= total || start > end) {
        return res.status(416).set('Content-Range', `bytes */${total}`).end();
      }
      res.status(206).set({
        'Content-Range': `bytes ${start}-${end}/${total}`,
        'Content-Length': String(end - start + 1)
      });
      createReadStream(filePath, { start, end }).pipe(res);
      return;
    }

    res.set('Content-Length', String(total));
    createReadStream(filePath).pipe(res);
  } catch (error) {
    next(error);
  }
});

mediaRouter.delete('/media/assets/:id', authenticate, authorize('media:delete'), async (req, res, next) => {
  try {
    if (req.query.confirm !== 'true' && req.body?.confirm !== true) {
      return res.status(400).json({
        success: false,
        error: 'Explicit deletion confirmation (confirm=true) is required'
      });
    }
    const deleted = await RepositoryFactory.getMediaRepository().deleteAsset(
      req.params.id,
      req.user.organizationId,
      { id: req.user.id, ipAddress: req.ip }
    );
    if (!deleted) return res.status(404).json({ success: false, error: 'Media asset not found' });
    await Promise.allSettled([
      mediaStorage.removeKey(deleted.storageKey),
      deleted.thumbnailKey ? mediaStorage.removeKey(deleted.thumbnailKey) : Promise.resolve(),
      deleted.previewKey && deleted.previewKey !== deleted.storageKey
        ? mediaStorage.removeKey(deleted.previewKey)
        : Promise.resolve()
    ]);
    res.json({ success: true, data: { id: deleted.id } });
  } catch (error) {
    next(error);
  }
});

// Resumable Upload Endpoints
mediaRouter.get('/media/uploads', authenticate, authorize('station:read'), async (req, res, next) => {
  try {
    await cleanupExpiredUploadSessions();
    const status = req.query.status ? String(req.query.status) : undefined;
    const sessions = await RepositoryFactory.getMediaRepository().listUploadSessions(req.user.organizationId, { status });
    res.json({ success: true, data: sessions });
  } catch (error) {
    next(error);
  }
});

mediaRouter.post('/media/uploads', authenticate, authorize('media:upload'), validateBody(initiateUploadSchema), async (req, res, next) => {
  try {
    const session = await initiateResumableUpload({
      ...req.body,
      organizationId: req.user.organizationId,
      userId: req.user.id,
      ipAddress: req.ip
    });
    res.status(201).set({
      'Upload-Offset': '0',
      'Upload-Expires': new Date(session.expiresAt).toUTCString()
    }).json({ success: true, data: session });
  } catch (error) {
    next(error);
  }
});

mediaRouter.get('/media/uploads/:id', authenticate, authorize('station:read'), async (req, res, next) => {
  try {
    const session = await getResumableUploadStatus(req.params.id, req.user.organizationId);
    if (!session) return res.status(404).json({ success: false, error: 'Upload session not found' });
    res.set({
      'Upload-Offset': String(session.receivedBytes),
      'Upload-Length': String(session.expectedSizeBytes),
      'Upload-Expires': new Date(session.expiresAt).toUTCString()
    }).json({ success: true, data: session });
  } catch (error) {
    next(error);
  }
});

mediaRouter.patch('/media/uploads/:id', authenticate, authorize('media:upload'), async (req, res, next) => {
  try {
    if (!req.is('application/offset+octet-stream') && !req.is('application/octet-stream')) {
      return res.status(415).json({
        success: false,
        error: 'Upload chunks require Content-Type: application/offset+octet-stream or application/octet-stream'
      });
    }
    const offsetHeader = req.get('Upload-Offset') ?? req.query.offset;
    if (offsetHeader === undefined || !/^\d+$/.test(String(offsetHeader))) {
      return res.status(400).json({ success: false, error: 'Provide a non-negative integer Upload-Offset header' });
    }
    const contentLengthHeader = req.get('Content-Length');
    const contentLength = contentLengthHeader !== undefined && /^\d+$/.test(contentLengthHeader)
      ? Number(contentLengthHeader)
      : undefined;
    const chunkChecksum = req.get('Upload-Checksum-Sha256') || null;
    if (chunkChecksum && !/^[a-fA-F0-9]{64}$/.test(chunkChecksum)) {
      return res.status(400).json({ success: false, error: 'Invalid Upload-Checksum-Sha256 header format' });
    }

    const updated = await streamUploadChunk({
      sessionId: req.params.id,
      organizationId: req.user.organizationId,
      offset: Number(offsetHeader),
      contentLength,
      expectedChunkSha256: chunkChecksum,
      requestStream: req
    });

    res.set({
      'Upload-Offset': String(updated.receivedBytes),
      'Upload-Length': String(updated.expectedSizeBytes)
    }).json({ success: true, data: updated });
  } catch (error) {
    if (error.details) {
      return res.status(error.statusCode || 409).set({
        'Upload-Offset': String(error.details.receivedBytes ?? 0)
      }).json({ success: false, error: error.message, details: error.details });
    }
    next(error);
  }
});

mediaRouter.post('/media/uploads/:id/complete', authenticate, authorize('media:upload'), validateBody(completeUploadSchema), async (req, res, next) => {
  try {
    const asset = await completeResumableUpload({
      sessionId: req.params.id,
      organizationId: req.user.organizationId,
      userId: req.user.id,
      ipAddress: req.ip,
      expectedChecksumSha256: req.body?.expectedChecksumSha256 || null
    });
    res.status(201).json({ success: true, data: asset });
  } catch (error) {
    next(error);
  }
});

mediaRouter.delete('/media/uploads/:id', authenticate, authorize('media:upload'), async (req, res, next) => {
  try {
    const cancelled = await cancelResumableUpload({
      sessionId: req.params.id,
      organizationId: req.user.organizationId,
      userId: req.user.id,
      ipAddress: req.ip
    });
    res.json({ success: true, data: cancelled });
  } catch (error) {
    next(error);
  }
});

// Server Directory & Remote URL Imports
mediaRouter.get('/media/import/directory', authenticate, authorize('media:upload'), async (_req, res, next) => {
  try {
    const files = await mediaStorage.listImportableFiles();
    res.json({ success: true, data: files });
  } catch (error) {
    next(error);
  }
});

mediaRouter.post('/media/import/directory', authenticate, authorize('media:upload'), validateBody(directoryImportSchema), async (req, res, next) => {
  try {
    const asset = await importFromAuthorizedServerDirectory({
      ...req.body,
      organizationId: req.user.organizationId,
      userId: req.user.id,
      ipAddress: req.ip
    });
    res.status(201).json({ success: true, data: asset });
  } catch (error) {
    next(error);
  }
});

mediaRouter.post('/media/import/url', authenticate, authorize('media:upload'), validateBody(urlImportSchema), async (req, res, next) => {
  try {
    const asset = await importFromAuthorizedRemoteUrl({
      ...req.body,
      organizationId: req.user.organizationId,
      userId: req.user.id,
      ipAddress: req.ip
    });
    res.status(201).json({ success: true, data: asset });
  } catch (error) {
    next(error);
  }
});

// Video & Audio Playlists
mediaRouter.get('/media/playlists', authenticate, authorize('station:read'), async (req, res, next) => {
  try {
    const kind = req.query.kind ? String(req.query.kind) : '';
    if (kind && !['VIDEO', 'AUDIO'].includes(kind)) {
      return res.status(400).json({ success: false, error: 'Invalid playlist kind' });
    }
    const data = await RepositoryFactory.getMediaRepository().listPlaylists(req.user.organizationId, { kind });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

mediaRouter.post('/media/playlists', authenticate, authorize('media:upload'), validateBody(playlistSchema), async (req, res, next) => {
  try {
    const playlist = await RepositoryFactory.getMediaRepository().createPlaylist({
      ...req.body,
      organizationId: req.user.organizationId,
      createdByUserId: req.user.id
    }, { id: req.user.id, ipAddress: req.ip });
    res.status(201).json({ success: true, data: playlist });
  } catch (error) {
    next(error);
  }
});

mediaRouter.delete('/media/playlists/:id', authenticate, authorize('media:delete'), async (req, res, next) => {
  try {
    const deleted = await RepositoryFactory.getMediaRepository().deletePlaylist(
      req.params.id,
      req.user.organizationId,
      { id: req.user.id, ipAddress: req.ip }
    );
    if (!deleted) return res.status(404).json({ success: false, error: 'Playlist not found' });
    res.json({ success: true, data: { id: deleted.id } });
  } catch (error) {
    next(error);
  }
});
