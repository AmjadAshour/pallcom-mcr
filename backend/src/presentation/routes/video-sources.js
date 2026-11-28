import { createReadStream } from 'node:fs';
import { Router } from 'express';
import { z } from 'zod';
import {
  VIDEO_SOURCE_AVAILABILITY,
  VIDEO_SOURCE_CONNECTION_STATUS,
  VIDEO_SOURCE_TYPES
} from '@mcr/shared';
import { mediaStorage } from '../../infrastructure/media/storage-manager.js';
import { RepositoryFactory } from '../../infrastructure/repositories/repository-factory.js';
import { CryptoService } from '../../infrastructure/security/crypto-service.js';
import {
  probeVideoSourceHealth,
  validateAndPrepareVideoSourceInput,
  validateVideoSourceUrl
} from '../../infrastructure/sources/video-source-service.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { authorize } from '../middlewares/rbac.middleware.js';
import { validateBody } from '../middlewares/validate.middleware.js';

export const videoSourcesRouter = Router();

const createSourceSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional().default(''),
  sourceType: z.enum(VIDEO_SOURCE_TYPES),
  stationId: z.string().trim().min(1).max(100).nullable().optional(),
  mediaAssetId: z.string().uuid().nullable().optional(),
  playlistId: z.string().uuid().nullable().optional(),
  streamUrl: z.string().trim().max(2048).nullable().optional(),
  secret: z.string().max(500).nullable().optional(),
  serverFilePath: z.string().trim().max(255).nullable().optional(),
  reconnectEnabled: z.boolean().optional().default(true),
  maxRetries: z.number().int().min(1).max(20).optional().default(5),
  backoffBaseMs: z.number().int().min(500).max(60000).optional().default(2000),
  backoffMaxMs: z.number().int().min(1000).max(300000).optional().default(30000),
  fallbackSourceId: z.string().uuid().nullable().optional(),
  fallbackAssetId: z.string().uuid().nullable().optional(),
  fallbackMode: z.enum(['SLATE', 'ASSET', 'SOURCE', 'HOLD_LAST_FRAME']).optional().default('SLATE')
}).strict().refine(s => s.backoffMaxMs >= s.backoffBaseMs, 'Maximum backoff must be greater than or equal to base backoff');

const updateSourceSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).optional(),
  stationId: z.string().trim().min(1).max(100).nullable().optional(),
  mediaAssetId: z.string().uuid().nullable().optional(),
  playlistId: z.string().uuid().nullable().optional(),
  streamUrl: z.string().trim().max(2048).nullable().optional(),
  secret: z.string().max(500).nullable().optional(),
  reconnectEnabled: z.boolean().optional(),
  maxRetries: z.number().int().min(1).max(20).optional(),
  backoffBaseMs: z.number().int().min(500).max(60000).optional(),
  backoffMaxMs: z.number().int().min(1000).max(300000).optional(),
  fallbackSourceId: z.string().uuid().nullable().optional(),
  fallbackAssetId: z.string().uuid().nullable().optional(),
  fallbackMode: z.enum(['SLATE', 'ASSET', 'SOURCE', 'HOLD_LAST_FRAME']).optional()
}).strict();

videoSourcesRouter.use('/video-sources', (_req, res, next) => {
  res.set({ 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' });
  next();
});

videoSourcesRouter.get('/video-sources', authenticate, authorize('station:read'), async (req, res, next) => {
  try {
    const sourceType = req.query.sourceType ? String(req.query.sourceType) : '';
    if (sourceType && !VIDEO_SOURCE_TYPES.includes(sourceType)) {
      return res.status(400).json({ success: false, error: 'Invalid video source type filter' });
    }
    const availabilityStatus = req.query.availabilityStatus ? String(req.query.availabilityStatus) : '';
    if (availabilityStatus && !Object.values(VIDEO_SOURCE_AVAILABILITY).includes(availabilityStatus)) {
      return res.status(400).json({ success: false, error: 'Invalid availability status filter' });
    }
    const stationId = req.query.stationId ? String(req.query.stationId) : '';
    const search = req.query.search ? String(req.query.search).slice(0, 120) : '';

    const data = await RepositoryFactory.getVideoSourceRepository().listSources(req.user.organizationId, {
      sourceType,
      stationId,
      availabilityStatus,
      search
    });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

videoSourcesRouter.get('/video-sources/:id', authenticate, authorize('station:read'), async (req, res, next) => {
  try {
    const source = await RepositoryFactory.getVideoSourceRepository().findSourceById(
      req.params.id,
      req.user.organizationId
    );
    if (!source) return res.status(404).json({ success: false, error: 'Video source not found' });
    res.json({ success: true, data: source });
  } catch (error) {
    next(error);
  }
});

videoSourcesRouter.post('/video-sources', authenticate, authorize('video:manage'), validateBody(createSourceSchema), async (req, res, next) => {
  try {
    const prepared = await validateAndPrepareVideoSourceInput(req.user.organizationId, req.body);
    const created = await RepositoryFactory.getVideoSourceRepository().createSource({
      ...req.body,
      organizationId: req.user.organizationId,
      streamUrl: prepared.normalizedUrl,
      serverFilePath: prepared.normalizedServerFile,
      encryptedSecret: prepared.encryptedSecret,
      ...prepared.initialProbe,
      createdByUserId: req.user.id
    }, { id: req.user.id, ipAddress: req.ip });

    res.status(201).json({ success: true, data: created });
  } catch (error) {
    next(error);
  }
});

videoSourcesRouter.patch('/video-sources/:id', authenticate, authorize('video:manage'), validateBody(updateSourceSchema), async (req, res, next) => {
  try {
    const repo = RepositoryFactory.getVideoSourceRepository();
    const existing = await repo.findSourceById(req.params.id, req.user.organizationId);
    if (!existing) return res.status(404).json({ success: false, error: 'Video source not found' });

    const updates = { ...req.body };
    if (updates.fallbackSourceId === existing.id) {
      return res.status(400).json({ success: false, error: 'A video source cannot be its own fallback' });
    }
    if (updates.streamUrl !== undefined && updates.streamUrl !== null) {
      updates.streamUrl = await validateVideoSourceUrl(existing.sourceType, updates.streamUrl);
    }
    if (updates.secret !== undefined) {
      updates.encryptedSecret = updates.secret ? CryptoService.encryptSecret(updates.secret.trim()) : null;
      delete updates.secret;
    }

    const updated = await repo.updateSource(
      req.params.id,
      req.user.organizationId,
      updates,
      { id: req.user.id, ipAddress: req.ip }
    );
    res.json({ success: true, data: updated });
  } catch (error) {
    next(error);
  }
});

videoSourcesRouter.post('/video-sources/:id/probe', authenticate, authorize('video:manage'), async (req, res, next) => {
  try {
    const result = await probeVideoSourceHealth(req.params.id, req.user.organizationId);
    if (!result) return res.status(404).json({ success: false, error: 'Video source not found' });
    await RepositoryFactory.getAuditRepository().create({
      organizationId: req.user.organizationId,
      userId: req.user.id,
      action: 'VIDEO_SOURCE_PROBED',
      resourceType: 'VideoSource',
      resourceId: req.params.id,
      details: {
        connectionStatus: result.connectionStatus,
        availabilityStatus: result.availabilityStatus,
        retryCount: result.retryCount
      },
      ipAddress: req.ip
    });
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

videoSourcesRouter.get('/video-sources/:id/preview', authenticate, authorize('station:read'), async (req, res, next) => {
  try {
    const repo = RepositoryFactory.getVideoSourceRepository();
    const source = await repo.findSourceById(req.params.id, req.user.organizationId);
    if (!source) return res.status(404).json({ success: false, error: 'Video source not found' });

    if (source.previewThumbnailKey) {
      const filePath = mediaStorage.resolveKeyPath(source.previewThumbnailKey);
      const info = await mediaStorage.verifyNoSymlink(filePath);
      if (info && info.isFile()) {
        res.set({
          'Content-Type': 'image/jpeg',
          'Content-Length': String(info.size),
          'X-Content-Type-Options': 'nosniff'
        });
        createReadStream(filePath).pipe(res);
        return;
      }
    }

    res.json({
      success: true,
      data: {
        id: source.id,
        name: source.name,
        sourceType: source.sourceType,
        connectionStatus: source.connectionStatus,
        availabilityStatus: source.availabilityStatus,
        resolution: source.width && source.height ? `${source.width}x${source.height}` : null,
        frameRate: source.frameRate,
        videoCodec: source.videoCodec,
        audioCodec: source.audioCodec,
        hasAudio: source.hasAudio,
        mediaPreviewUrl: source.mediaAssetId ? `/api/v1/media/assets/${encodeURIComponent(source.mediaAssetId)}/preview` : null
      }
    });
  } catch (error) {
    next(error);
  }
});

videoSourcesRouter.delete('/video-sources/:id', authenticate, authorize('video:manage'), async (req, res, next) => {
  try {
    if (req.query.confirm !== 'true' && req.body?.confirm !== true) {
      return res.status(400).json({
        success: false,
        error: 'Explicit deletion confirmation (confirm=true) is required'
      });
    }
    const deleted = await RepositoryFactory.getVideoSourceRepository().deleteSource(
      req.params.id,
      req.user.organizationId,
      { id: req.user.id, ipAddress: req.ip }
    );
    if (!deleted) return res.status(404).json({ success: false, error: 'Video source not found' });
    res.json({ success: true, data: { id: deleted.id } });
  } catch (error) {
    next(error);
  }
});
