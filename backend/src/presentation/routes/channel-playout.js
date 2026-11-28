import { Router } from 'express';
import { z } from 'zod';
import {
  CHANNEL_FALLBACK_MODES,
  CHANNEL_PLAYOUT_MODES
} from '@mcr/shared';
import {
  multiChannelPlayout,
  validateCameraDestinationWithAllowlist,
  validateFallbackHierarchy
} from '../../infrastructure/playout/channel-playout-supervisor.js';
import { RepositoryFactory } from '../../infrastructure/repositories/repository-factory.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { authorize } from '../middlewares/rbac.middleware.js';
import { validateBody } from '../middlewares/validate.middleware.js';

export const channelPlayoutRouter = Router();

const cameraSequenceEntrySchema = z.object({
  id: z.string().trim().min(1).max(100).optional(),
  sourceId: z.string().trim().min(1).max(100).optional(),
  name: z.string().trim().min(1).max(200).optional(),
  uri: z.string().trim().max(2048).nullable().optional(),
  udpPort: z.number().int().min(1024).max(65535).nullable().optional(),
  durationSeconds: z.number().int().min(1).max(86400).optional().default(10),
  enabled: z.boolean().optional().default(true)
}).strict();

const movieQueueEntrySchema = z.object({
  id: z.string().trim().min(1).max(100).optional(),
  assetId: z.string().uuid(),
  sourceId: z.string().trim().max(100).optional(),
  title: z.string().trim().max(250).optional(),
  durationSeconds: z.number().min(0.5).max(345600).optional()
}).strict();

const networkAllowlistEntrySchema = z.object({
  host: z.string().trim().min(1).max(255),
  port: z.number().int().min(1).max(65535).optional(),
  description: z.string().trim().max(300).optional().default('')
}).strict();

const updatePlayoutConfigSchema = z.object({
  expectedRevision: z.number().int().positive().optional(),
  playoutMode: z.enum(CHANNEL_PLAYOUT_MODES).optional(),
  autoStart: z.boolean().optional(),
  width: z.number().int().min(320).max(3840).optional(),
  height: z.number().int().min(180).max(2160).optional(),
  frameRate: z.number().int().min(15).max(60).optional(),
  videoBitrateKbps: z.number().int().min(500).max(25000).optional(),
  gopFrames: z.number().int().min(10).max(300).optional(),
  audioBitrateKbps: z.number().int().min(64).max(320).optional(),
  hwAccelMode: z.enum(['AUTO_WITH_SW_FALLBACK', 'SOFTWARE_ONLY', 'PREFER_HARDWARE']).optional(),
  cameraSequence: z.array(cameraSequenceEntrySchema).max(64).optional(),
  cameraRepeat: z.boolean().optional(),
  activeCameraIndex: z.number().int().min(0).max(63).optional(),
  movieQueue: z.array(movieQueueEntrySchema).max(200).optional(),
  movieRepeat: z.boolean().optional(),
  activeMovieIndex: z.number().int().min(0).max(199).optional(),
  adSchedulePolicy: z.object({
    enabled: z.boolean(),
    intervalMovies: z.number().int().min(1).max(50).optional().default(1),
    adAssetIds: z.array(z.string().uuid()).max(50).optional().default([])
  }).strict().optional(),
  graphicsConfig: z.object({
    watermarkEnabled: z.boolean().optional().default(true),
    tickerEnabled: z.boolean().optional().default(false),
    tickerText: z.string().trim().max(500).optional().default('')
  }).strict().optional(),
  fallbackConfig: z.object({
    mode: z.enum(CHANNEL_FALLBACK_MODES).optional().default('BLACK_SLATE'),
    fallbackSourceId: z.string().uuid().nullable().optional(),
    fallbackAssetId: z.string().uuid().nullable().optional(),
    fallbackPlaylistId: z.string().uuid().nullable().optional()
  }).strict().optional(),
  networkAllowlist: z.array(networkAllowlistEntrySchema).max(50).optional(),
  outputUdpPort: z.number().int().min(1024).max(65535).nullable().optional(),
  outputHlsEnabled: z.boolean().optional(),
  outputSrtUrl: z.string().trim().max(1024).nullable().optional()
}).strict();

const lifecycleActionSchema = z.object({
  action: z.enum(['start', 'stop', 'restart'])
}).strict();

const manualCameraSwitchSchema = z.object({
  cameraIndex: z.number().int().min(0).max(63)
}).strict();

const cameraExclusionSchema = z.object({
  sourceId: z.string().trim().min(1).max(100),
  excluded: z.boolean()
}).strict();

const manualMovieSelectSchema = z.object({
  movieIndex: z.number().int().min(0).max(199),
  seekMs: z.number().int().min(0).max(345600000).optional().default(0)
}).strict();

const movieSeekSchema = z.object({
  positionMs: z.number().int().min(0).max(345600000)
}).strict();

const moviePauseSchema = z.object({
  paused: z.boolean()
}).strict();

const emergencySwitchSchema = z.object({
  enabled: z.boolean(),
  emergencySourceId: z.string().uuid().nullable().optional()
}).strict();

async function requireChannelOwnership(req, res) {
  const { channelId } = req.params;
  const station = await RepositoryFactory.getStationRepository().findById(channelId, req.user.organizationId);
  if (!station) {
    res.status(404).json({ success: false, error: 'Channel / station not found' });
    return null;
  }
  return station;
}

channelPlayoutRouter.use('/channels/:channelId/playout', (_req, res, next) => {
  res.set({ 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' });
  next();
});

channelPlayoutRouter.get('/channels/:channelId/playout', authenticate, authorize('station:read'), async (req, res, next) => {
  try {
    if (!await requireChannelOwnership(req, res)) return;
    const { channelId } = req.params;
    const inst = multiChannelPlayout.getInstance(channelId, req.user.organizationId);
    const snapshot = await inst.getFullSnapshot();
    res.json({ success: true, data: snapshot });
  } catch (error) {
    next(error);
  }
});

channelPlayoutRouter.get('/channels/:channelId/playout/monitor-frame', authenticate, authorize('station:read'), async (req, res, next) => {
  try {
    if (!await requireChannelOwnership(req, res)) return;
    const { channelId } = req.params;
    const inst = multiChannelPlayout.getInstance(channelId, req.user.organizationId);
    res.json({
      success: true,
      data: {
        channelId,
        frame: inst.programMonitorFrame?.image || null,
        capturedAt: inst.programMonitorFrame?.at ? new Date(inst.programMonitorFrame.at).toISOString() : null
      }
    });
  } catch (error) {
    next(error);
  }
});

channelPlayoutRouter.patch('/channels/:channelId/playout/config', authenticate, authorize('station:manage'), validateBody(updatePlayoutConfigSchema), async (req, res, next) => {
  try {
    if (!await requireChannelOwnership(req, res)) return;
    const { channelId } = req.params;
    const repo = RepositoryFactory.getChannelPlayoutRepository();
    const current = await repo.getChannelConfig(channelId, req.user.organizationId);
    const allowlist = req.body.networkAllowlist ?? current.networkAllowlist ?? [];

    // Validate any direct camera URIs in cameraSequence against SSRF + channel VPN allowlist
    if (Array.isArray(req.body.cameraSequence)) {
      for (const cam of req.body.cameraSequence) {
        if (cam.uri) {
          cam.uri = validateCameraDestinationWithAllowlist(cam.uri, allowlist);
        }
      }
    }

    // Validate fallback hierarchy against circular references
    if (req.body.fallbackConfig) {
      const channelSources = await RepositoryFactory.getVideoSourceRepository().listSources(req.user.organizationId);
      validateFallbackHierarchy(req.body.fallbackConfig, channelSources);
    }

    await repo.saveChannelConfig(channelId, req.user.organizationId, req.body, {
      id: req.user.id,
      ipAddress: req.ip,
      auditAction: 'CHANNEL_PLAYOUT_CONFIG_UPDATED'
    });

    const inst = multiChannelPlayout.getInstance(channelId, req.user.organizationId);
    const snapshot = await inst.getFullSnapshot();
    res.json({ success: true, data: snapshot });
  } catch (error) {
    next(error);
  }
});

channelPlayoutRouter.post('/channels/:channelId/playout/lifecycle', authenticate, authorize('station:control'), validateBody(lifecycleActionSchema), async (req, res, next) => {
  try {
    if (!await requireChannelOwnership(req, res)) return;
    const { channelId } = req.params;
    const inst = multiChannelPlayout.getInstance(channelId, req.user.organizationId);
    const actor = { id: req.user.id, ipAddress: req.ip };
    let snapshot;
    if (req.body.action === 'start') {
      snapshot = await inst.start(actor);
    } else if (req.body.action === 'stop') {
      snapshot = await inst.stop(actor);
    } else {
      snapshot = await inst.restart(actor);
    }
    res.json({ success: true, data: snapshot });
  } catch (error) {
    next(error);
  }
});

channelPlayoutRouter.post('/channels/:channelId/playout/camera/switch', authenticate, authorize('station:control'), validateBody(manualCameraSwitchSchema), async (req, res, next) => {
  try {
    if (!await requireChannelOwnership(req, res)) return;
    const { channelId } = req.params;
    const inst = multiChannelPlayout.getInstance(channelId, req.user.organizationId);
    const snapshot = await inst.switchCameraManual(req.body.cameraIndex, { id: req.user.id, ipAddress: req.ip });
    res.json({ success: true, data: snapshot });
  } catch (error) {
    next(error);
  }
});

channelPlayoutRouter.post('/channels/:channelId/playout/camera/exclude', authenticate, authorize('station:control'), validateBody(cameraExclusionSchema), async (req, res, next) => {
  try {
    if (!await requireChannelOwnership(req, res)) return;
    const { channelId } = req.params;
    const inst = multiChannelPlayout.getInstance(channelId, req.user.organizationId);
    const snapshot = await inst.setCameraExclusion(req.body.sourceId, req.body.excluded, {
      id: req.user.id,
      ipAddress: req.ip
    });
    res.json({ success: true, data: snapshot });
  } catch (error) {
    next(error);
  }
});

channelPlayoutRouter.post('/channels/:channelId/playout/movie/select', authenticate, authorize('station:control'), validateBody(manualMovieSelectSchema), async (req, res, next) => {
  try {
    if (!await requireChannelOwnership(req, res)) return;
    const { channelId } = req.params;
    const inst = multiChannelPlayout.getInstance(channelId, req.user.organizationId);
    const snapshot = await inst.selectMovieManual(req.body.movieIndex, req.body.seekMs, {
      id: req.user.id,
      ipAddress: req.ip
    });
    res.json({ success: true, data: snapshot });
  } catch (error) {
    next(error);
  }
});

channelPlayoutRouter.post('/channels/:channelId/playout/movie/seek', authenticate, authorize('station:control'), validateBody(movieSeekSchema), async (req, res, next) => {
  try {
    if (!await requireChannelOwnership(req, res)) return;
    const { channelId } = req.params;
    const inst = multiChannelPlayout.getInstance(channelId, req.user.organizationId);
    const snapshot = await inst.seekMovie(req.body.positionMs, { id: req.user.id, ipAddress: req.ip });
    res.json({ success: true, data: snapshot });
  } catch (error) {
    next(error);
  }
});

channelPlayoutRouter.post('/channels/:channelId/playout/movie/pause', authenticate, authorize('station:control'), validateBody(moviePauseSchema), async (req, res, next) => {
  try {
    if (!await requireChannelOwnership(req, res)) return;
    const { channelId } = req.params;
    const inst = multiChannelPlayout.getInstance(channelId, req.user.organizationId);
    const snapshot = await inst.setMoviePaused(req.body.paused, { id: req.user.id, ipAddress: req.ip });
    res.json({ success: true, data: snapshot });
  } catch (error) {
    next(error);
  }
});

channelPlayoutRouter.post('/channels/:channelId/playout/emergency', authenticate, authorize('broadcast:emergency'), validateBody(emergencySwitchSchema), async (req, res, next) => {
  try {
    if (!await requireChannelOwnership(req, res)) return;
    const { channelId } = req.params;
    const inst = multiChannelPlayout.getInstance(channelId, req.user.organizationId);
    const snapshot = await inst.triggerEmergencySwitch(req.body, { id: req.user.id, ipAddress: req.ip });
    res.json({ success: true, data: snapshot });
  } catch (error) {
    next(error);
  }
});
