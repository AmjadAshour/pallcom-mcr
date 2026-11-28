import { Router } from 'express';
import { z } from 'zod';
import {
  AUDIO_AD_POLICIES,
  AUDIO_REPEAT_MODES,
  AUDIO_ROUTING_MODES,
  AUDIO_SOURCE_STATES,
  AUDIO_SOURCE_TYPES
} from '@mcr/shared';
import {
  multiChannelAudio,
  probeAudioSourceHealth,
  validateAndPrepareAudioSourceInput,
  validateRadioStreamUrl
} from '../../infrastructure/audio/audio-mixer-engine.js';
import { RepositoryFactory } from '../../infrastructure/repositories/repository-factory.js';
import { CryptoService } from '../../infrastructure/security/crypto-service.js';
import { authenticate, hasCurrentPermission } from '../middlewares/auth.middleware.js';
import { authorize } from '../middlewares/rbac.middleware.js';
import { validateBody } from '../middlewares/validate.middleware.js';

export const audioRouter = Router();

const createAudioSourceSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional().default(''),
  sourceType: z.enum(AUDIO_SOURCE_TYPES),
  mediaAssetId: z.string().uuid().nullable().optional(),
  playlistId: z.string().uuid().nullable().optional(),
  videoSourceId: z.string().uuid().nullable().optional(),
  obsInputName: z.string().trim().max(200).nullable().optional(),
  streamUrl: z.string().trim().max(2048).nullable().optional(),
  secret: z.string().max(500).nullable().optional(),
  enabled: z.boolean().optional().default(true),
  muted: z.boolean().optional().default(false),
  soloMonitoring: z.boolean().optional().default(false),
  volumeLinear: z.number().min(0).max(2).optional().default(1.0),
  gainDb: z.number().min(-60).max(18).optional().default(0.0),
  delayMs: z.number().int().min(0).max(10000).optional().default(0),
  fadeInMs: z.number().int().min(0).max(30000).optional().default(500),
  fadeOutMs: z.number().int().min(0).max(30000).optional().default(500),
  priority: z.number().int().min(0).max(100).optional().default(50),
  duckingTrigger: z.boolean().optional().default(false),
  duckingTarget: z.boolean().optional().default(true),
  repeatMode: z.enum(AUDIO_REPEAT_MODES).optional().default('REPEAT_PLAYLIST'),
  shuffleEnabled: z.boolean().optional().default(false),
  crossfadeMs: z.number().int().min(0).max(15000).optional().default(1500),
  reconnectEnabled: z.boolean().optional().default(true),
  maxRetries: z.number().int().min(1).max(20).optional().default(5),
  backoffBaseMs: z.number().int().min(500).max(60000).optional().default(2000),
  backoffMaxMs: z.number().int().min(1000).max(300000).optional().default(30000),
  fallbackSourceId: z.string().uuid().nullable().optional(),
  fallbackAssetId: z.string().uuid().nullable().optional()
}).strict();

const updateAudioSourceSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).optional(),
  mediaAssetId: z.string().uuid().nullable().optional(),
  playlistId: z.string().uuid().nullable().optional(),
  videoSourceId: z.string().uuid().nullable().optional(),
  obsInputName: z.string().trim().max(200).nullable().optional(),
  streamUrl: z.string().trim().max(2048).nullable().optional(),
  secret: z.string().max(500).nullable().optional(),
  enabled: z.boolean().optional(),
  muted: z.boolean().optional(),
  soloMonitoring: z.boolean().optional(),
  volumeLinear: z.number().min(0).max(2).optional(),
  gainDb: z.number().min(-60).max(18).optional(),
  delayMs: z.number().int().min(0).max(10000).optional(),
  fadeInMs: z.number().int().min(0).max(30000).optional(),
  fadeOutMs: z.number().int().min(0).max(30000).optional(),
  priority: z.number().int().min(0).max(100).optional(),
  duckingTrigger: z.boolean().optional(),
  duckingTarget: z.boolean().optional(),
  repeatMode: z.enum(AUDIO_REPEAT_MODES).optional(),
  shuffleEnabled: z.boolean().optional(),
  crossfadeMs: z.number().int().min(0).max(15000).optional(),
  reconnectEnabled: z.boolean().optional(),
  maxRetries: z.number().int().min(1).max(20).optional(),
  backoffBaseMs: z.number().int().min(500).max(60000).optional(),
  backoffMaxMs: z.number().int().min(1000).max(300000).optional(),
  fallbackSourceId: z.string().uuid().nullable().optional(),
  fallbackAssetId: z.string().uuid().nullable().optional()
}).strict();

const updateMixerConfigSchema = z.object({
  masterVolumeLinear: z.number().min(0).max(2).optional(),
  masterGainDb: z.number().min(-60).max(18).optional(),
  masterMuted: z.boolean().optional(),
  routingMode: z.enum(AUDIO_ROUTING_MODES).optional(),
  cameraAudioMuted: z.boolean().optional(),
  cameraAudioGainDb: z.number().min(-60).max(18).optional(),
  duckingEnabled: z.boolean().optional(),
  duckingThresholdDbfs: z.number().min(-80).max(0).optional(),
  duckingReductionDb: z.number().min(-48).max(0).optional(),
  duckingAttackMs: z.number().int().min(20).max(5000).optional(),
  duckingHoldMs: z.number().int().min(0).max(10000).optional(),
  duckingReleaseMs: z.number().int().min(50).max(15000).optional(),
  crossfadeDurationMs: z.number().int().min(0).max(15000).optional(),
  adAudioPolicy: z.enum(AUDIO_AD_POLICIES).optional(),
  adActive: z.boolean().optional(),
  peakLimiterCeilingDbfs: z.number().min(-24).max(-0.1).optional(),
  loudnessNormalization: z.boolean().optional(),
  targetLoudnessLufs: z.number().min(-36).max(-9).optional(),
  silenceThresholdDbfs: z.number().min(-90).max(-20).optional(),
  silenceTimeoutSeconds: z.number().int().min(1).max(300).optional(),
  fallbackSourceId: z.string().uuid().nullable().optional(),
  fallbackAssetId: z.string().uuid().nullable().optional(),
  outputBitrateKbps: z.number().int().min(64).max(320).optional()
}).strict();

const microphoneControlSchema = z.object({
  action: z.enum(['activate', 'deactivate']),
  pushToTalk: z.boolean().optional().default(false)
}).strict();

const microphoneIngestSchema = z.object({
  pcmBase64: z.string().min(4).max(1024 * 1024)
}).strict();

const stepMixSchema = z.object({
  frames: z.number().int().min(1).max(250).optional().default(1),
  persistMeters: z.boolean().optional().default(true)
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

audioRouter.use('/channels/:channelId/audio', (_req, res, next) => {
  res.set({ 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' });
  next();
});

audioRouter.get('/channels/:channelId/audio', authenticate, authorize('station:read'), async (req, res, next) => {
  try {
    if (!await requireChannelOwnership(req, res)) return;
    const { channelId } = req.params;
    const audioRepo = RepositoryFactory.getAudioRepository();
    const [mixer, sources] = await Promise.all([
      audioRepo.getChannelMixerConfig(channelId, req.user.organizationId),
      audioRepo.listAudioSources(req.user.organizationId, { channelId })
    ]);
    res.json({ success: true, data: { mixer, sources } });
  } catch (error) {
    next(error);
  }
});

audioRouter.patch('/channels/:channelId/audio/mixer', authenticate, authorize('audio:manage'), validateBody(updateMixerConfigSchema), async (req, res, next) => {
  try {
    if (!await requireChannelOwnership(req, res)) return;
    const { channelId } = req.params;
    const updated = await RepositoryFactory.getAudioRepository().saveChannelMixerConfig(
      channelId,
      req.user.organizationId,
      req.body,
      { id: req.user.id, ipAddress: req.ip }
    );
    res.json({ success: true, data: updated });
  } catch (error) {
    next(error);
  }
});

audioRouter.get('/channels/:channelId/audio/sources', authenticate, authorize('station:read'), async (req, res, next) => {
  try {
    if (!await requireChannelOwnership(req, res)) return;
    const { channelId } = req.params;
    const sourceType = req.query.sourceType ? String(req.query.sourceType) : '';
    if (sourceType && !AUDIO_SOURCE_TYPES.includes(sourceType)) {
      return res.status(400).json({ success: false, error: 'Invalid audio source type filter' });
    }
    const sources = await RepositoryFactory.getAudioRepository().listAudioSources(req.user.organizationId, {
      channelId,
      sourceType
    });
    res.json({ success: true, data: sources });
  } catch (error) {
    next(error);
  }
});

audioRouter.post('/channels/:channelId/audio/sources', authenticate, authorize('audio:manage'), validateBody(createAudioSourceSchema), async (req, res, next) => {
  try {
    if (!await requireChannelOwnership(req, res)) return;
    const { channelId } = req.params;
    const prepared = await validateAndPrepareAudioSourceInput(req.user.organizationId, channelId, req.body);

    const created = await RepositoryFactory.getAudioRepository().createAudioSource({
      ...req.body,
      organizationId: req.user.organizationId,
      channelId,
      streamUrl: prepared.normalizedUrl,
      encryptedSecret: prepared.encryptedSecret,
      currentTrackAssetId: prepared.initialTrackAssetId,
      codec: prepared.codec,
      sampleRateHz: prepared.sampleRateHz,
      channels: prepared.channels,
      state: prepared.state,
      createdByUserId: req.user.id
    }, { id: req.user.id, ipAddress: req.ip });

    if (prepared.decodedPcm) {
      multiChannelAudio.getEngine(channelId, req.user.organizationId).loadSourcePcm(created.id, prepared.decodedPcm);
    }

    res.status(201).json({ success: true, data: created });
  } catch (error) {
    next(error);
  }
});

audioRouter.patch('/channels/:channelId/audio/sources/:id', authenticate, authorize('audio:manage'), validateBody(updateAudioSourceSchema), async (req, res, next) => {
  try {
    if (!await requireChannelOwnership(req, res)) return;
    const { channelId, id } = req.params;
    const audioRepo = RepositoryFactory.getAudioRepository();
    const existing = await audioRepo.findAudioSourceById(id, req.user.organizationId);
    if (!existing || existing.channelId !== channelId) {
      return res.status(404).json({ success: false, error: 'Audio source not found on this channel' });
    }

    const updates = { ...req.body };
    if (updates.fallbackSourceId === existing.id) {
      return res.status(400).json({ success: false, error: 'An audio source cannot be its own fallback' });
    }
    if (updates.streamUrl !== undefined && updates.streamUrl !== null) {
      updates.streamUrl = await validateRadioStreamUrl(updates.streamUrl);
    }
    if (updates.secret !== undefined) {
      updates.encryptedSecret = updates.secret ? CryptoService.encryptSecret(updates.secret.trim()) : null;
      delete updates.secret;
    }

    const updated = await audioRepo.updateAudioSource(id, req.user.organizationId, updates, {
      id: req.user.id,
      ipAddress: req.ip
    });
    res.json({ success: true, data: updated });
  } catch (error) {
    next(error);
  }
});

audioRouter.post('/channels/:channelId/audio/sources/:id/probe', authenticate, authorize('audio:manage'), async (req, res, next) => {
  try {
    if (!await requireChannelOwnership(req, res)) return;
    const { channelId, id } = req.params;
    const audioRepo = RepositoryFactory.getAudioRepository();
    const existing = await audioRepo.findAudioSourceById(id, req.user.organizationId);
    if (!existing || existing.channelId !== channelId) {
      return res.status(404).json({ success: false, error: 'Audio source not found on this channel' });
    }
    const probed = await probeAudioSourceHealth(id, req.user.organizationId);
    await RepositoryFactory.getAuditRepository().create({
      organizationId: req.user.organizationId,
      userId: req.user.id,
      action: 'AUDIO_SOURCE_PROBED',
      resourceType: 'AudioSource',
      resourceId: id,
      details: { channelId, state: probed.state, retryCount: probed.retryCount },
      ipAddress: req.ip
    });
    res.json({ success: true, data: probed });
  } catch (error) {
    next(error);
  }
});

audioRouter.post('/channels/:channelId/audio/sources/:id/microphone', authenticate, authorize('audio:manage'), validateBody(microphoneControlSchema), async (req, res, next) => {
  try {
    if (!await requireChannelOwnership(req, res)) return;
    if (!hasCurrentPermission(req.user, 'audio:manage')) {
      return res.status(403).json({ success: false, error: 'Microphone authorization revoked' });
    }
    const { channelId, id } = req.params;
    const audioRepo = RepositoryFactory.getAudioRepository();
    const existing = await audioRepo.findAudioSourceById(id, req.user.organizationId);
    if (!existing || existing.channelId !== channelId || existing.sourceType !== 'MICROPHONE_INPUT') {
      return res.status(404).json({ success: false, error: 'Microphone source not found on this channel' });
    }

    const engine = multiChannelAudio.getEngine(channelId, req.user.organizationId);
    const { action, pushToTalk } = req.body;
    const expiresAt = res.locals.accessTokenExpiresAt || (Date.now() + 15 * 60 * 1000);

    if (action === 'activate') {
      engine.activateMicrophone(id, {
        userId: req.user.id,
        sessionId: req.user.sessionId,
        expiresAt,
        pushToTalk
      });
    } else {
      engine.deactivateMicrophone(id);
    }

    const updated = await audioRepo.updateAudioSourceRuntimeState(id, req.user.organizationId, {
      state: action === 'activate' ? AUDIO_SOURCE_STATES.PLAYING : AUDIO_SOURCE_STATES.PAUSED,
      lastConnectedAt: action === 'activate' ? new Date().toISOString() : existing.lastConnectedAt
    });

    await RepositoryFactory.getAuditRepository().create({
      organizationId: req.user.organizationId,
      userId: req.user.id,
      action: action === 'activate' ? 'MICROPHONE_ACTIVATED' : 'MICROPHONE_DEACTIVATED',
      resourceType: 'AudioSource',
      resourceId: id,
      details: { channelId, pushToTalk },
      ipAddress: req.ip
    });

    res.json({ success: true, data: updated });
  } catch (error) {
    next(error);
  }
});

audioRouter.post('/channels/:channelId/audio/sources/:id/microphone/pcm', authenticate, authorize('audio:manage'), validateBody(microphoneIngestSchema), async (req, res, next) => {
  try {
    if (!await requireChannelOwnership(req, res)) return;
    if (!hasCurrentPermission(req.user, 'audio:manage')) {
      return res.status(403).json({ success: false, error: 'Microphone authorization revoked' });
    }
    const { channelId, id } = req.params;
    const audioRepo = RepositoryFactory.getAudioRepository();
    const existing = await audioRepo.findAudioSourceById(id, req.user.organizationId);
    if (!existing || existing.channelId !== channelId || existing.sourceType !== 'MICROPHONE_INPUT') {
      return res.status(404).json({ success: false, error: 'Microphone source not found on this channel' });
    }
    const pcmBuffer = Buffer.from(req.body.pcmBase64, 'base64');
    if (!pcmBuffer.length || pcmBuffer.length > 512 * 1024) {
      return res.status(400).json({ success: false, error: 'Invalid microphone PCM payload length' });
    }
    const engine = multiChannelAudio.getEngine(channelId, req.user.organizationId);
    engine.pushMicrophonePcm(id, pcmBuffer, {
      userId: req.user.id,
      sessionId: req.user.sessionId
    });
    res.json({ success: true, bytesAccepted: pcmBuffer.length });
  } catch (error) {
    next(error);
  }
});

audioRouter.post('/channels/:channelId/audio/step', authenticate, authorize('audio:manage'), validateBody(stepMixSchema), async (req, res, next) => {
  try {
    if (!await requireChannelOwnership(req, res)) return;
    const { channelId } = req.params;
    const { frames, persistMeters } = req.body;
    const engine = multiChannelAudio.getEngine(channelId, req.user.organizationId);
    let lastResult;
    const broadcastBuffers = [];
    const monitorBuffers = [];

    for (let i = 0; i < frames; i++) {
      lastResult = await engine.stepFrame({ persistMeters: persistMeters && i === frames - 1 });
      broadcastBuffers.push(lastResult.broadcastMix.pcmBuffer);
      monitorBuffers.push(lastResult.monitorMix.pcmBuffer);
    }

    res.json({
      success: true,
      data: {
        frameIndex: lastResult.frameIndex,
        ptsMs: lastResult.ptsMs,
        masterRmsDbfs: lastResult.broadcastMix.masterRmsDbfs,
        masterPeakDbfs: lastResult.broadcastMix.masterPeakDbfs,
        monitorRmsDbfs: lastResult.monitorMix.masterRmsDbfs,
        monitorPeakDbfs: lastResult.monitorMix.masterPeakDbfs,
        clippingPrevented: lastResult.broadcastMix.clippingPrevented,
        duckingReductionAppliedDb: lastResult.broadcastMix.duckingReductionAppliedDb,
        sources: lastResult.sources,
        broadcastPcmBase64: Buffer.concat(broadcastBuffers).toString('base64'),
        monitorPcmBase64: Buffer.concat(monitorBuffers).toString('base64')
      }
    });
  } catch (error) {
    next(error);
  }
});

audioRouter.delete('/channels/:channelId/audio/sources/:id', authenticate, authorize('audio:manage'), async (req, res, next) => {
  try {
    if (!await requireChannelOwnership(req, res)) return;
    if (req.query.confirm !== 'true' && req.body?.confirm !== true) {
      return res.status(400).json({
        success: false,
        error: 'Explicit deletion confirmation (confirm=true) is required'
      });
    }
    const { channelId, id } = req.params;
    const audioRepo = RepositoryFactory.getAudioRepository();
    const existing = await audioRepo.findAudioSourceById(id, req.user.organizationId);
    if (!existing || existing.channelId !== channelId) {
      return res.status(404).json({ success: false, error: 'Audio source not found on this channel' });
    }
    const deleted = await audioRepo.deleteAudioSource(id, req.user.organizationId, {
      id: req.user.id,
      ipAddress: req.ip
    });
    multiChannelAudio.getEngine(channelId, req.user.organizationId).sourceBuffers.delete(id);
    multiChannelAudio.getEngine(channelId, req.user.organizationId).deactivateMicrophone(id);
    res.json({ success: true, data: { id: deleted.id } });
  } catch (error) {
    next(error);
  }
});
