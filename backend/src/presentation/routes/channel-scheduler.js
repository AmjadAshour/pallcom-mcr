import { Router } from 'express';
import { z } from 'zod';
import {
  csvTextCell,
  SCHEDULE_ACTIVATION_POLICIES,
  SCHEDULE_EXECUTION_MODES,
  SCHEDULE_GAP_POLICIES,
  SCHEDULE_RECURRENCE_FREQUENCIES,
  SCHEDULE_TRACK_TYPES
} from '@mcr/shared';
import {
  expandScheduleOccurrences,
  generateChannelEpgGuide,
  multiChannelScheduler,
  validateScheduleRevision
} from '../../infrastructure/scheduler/broadcast-scheduler-engine.js';
import { RepositoryFactory } from '../../infrastructure/repositories/repository-factory.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { authorize } from '../middlewares/rbac.middleware.js';
import { validateBody } from '../middlewares/validate.middleware.js';

export const channelSchedulerRouter = Router();

const recurrenceSchema = z.object({
  frequency: z.enum(SCHEDULE_RECURRENCE_FREQUENCIES).optional().default('ONCE'),
  weekdays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  untilUtc: z.string().trim().max(64).nullable().optional(),
  count: z.number().int().min(1).max(2000).optional(),
  exceptionDates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(366).optional().default([])
}).strict();

const scheduleEventSchema = z.object({
  id: z.string().trim().min(1).max(100),
  channelId: z.string().trim().max(100).optional(),
  trackType: z.enum(SCHEDULE_TRACK_TYPES),
  executionMode: z.enum(SCHEDULE_EXECUTION_MODES).optional().default('HARD_START'),
  title: z.string().trim().min(1).max(250),
  description: z.string().trim().max(2000).optional().default(''),
  category: z.string().trim().max(80).optional().default('PROGRAM'),
  mediaAssetId: z.string().uuid().nullable().optional(),
  videoSourceId: z.string().uuid().nullable().optional(),
  audioSourceId: z.string().uuid().nullable().optional(),
  startUtc: z.string().trim().max(64).nullable().optional(),
  endUtc: z.string().trim().max(64).nullable().optional(),
  localStartDateTime: z.string().trim().max(32).nullable().optional(),
  dstDisambiguation: z.enum(['REJECT', 'EARLIER', 'LATER']).optional().default('REJECT'),
  durationMs: z.number().int().min(500).max(345600000),
  priority: z.number().int().min(0).max(100).optional().default(50),
  allowPreemption: z.boolean().optional().default(true),
  afterEventId: z.string().trim().max(100).nullable().optional(),
  transitionType: z.enum(['CUT', 'CROSSFADE', 'FADE_BLACK']).optional().default('CUT'),
  transitionDurationMs: z.number().int().min(0).max(15000).optional().default(500),
  recurrence: recurrenceSchema.optional(),
  fallbackAssetId: z.string().uuid().nullable().optional(),
  fallbackSourceId: z.string().uuid().nullable().optional(),
  enabled: z.boolean().optional().default(true),
  metadata: z.record(z.string(), z.unknown()).optional().default({})
}).strict();

const templateSchema = z.object({
  id: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(1000).optional().default(''),
  events: z.array(scheduleEventSchema).max(500)
}).strict();

const saveDraftSchema = z.object({
  expectedRevisionNumber: z.number().int().positive().optional(),
  name: z.string().trim().min(1).max(200).optional(),
  timezone: z.string().trim().min(1).max(80).optional(),
  activationPolicy: z.enum(SCHEDULE_ACTIVATION_POLICIES).optional(),
  effectiveFromUtc: z.string().trim().max(64).nullable().optional(),
  gapPolicy: z.enum(SCHEDULE_GAP_POLICIES).optional(),
  gapFallbackAssetId: z.string().uuid().nullable().optional(),
  gapFallbackSourceId: z.string().uuid().nullable().optional(),
  gapFallbackPlaylistId: z.string().uuid().nullable().optional(),
  events: z.array(scheduleEventSchema).max(1000).optional(),
  templates: z.array(templateSchema).max(50).optional()
}).strict();

const publishScheduleSchema = z.object({
  revisionId: z.string().uuid().optional(),
  expectedRevisionNumber: z.number().int().positive().optional(),
  activationPolicy: z.enum(SCHEDULE_ACTIVATION_POLICIES).optional().default('APPLY_NEXT_BOUNDARY'),
  effectiveFromUtc: z.string().trim().max(64).nullable().optional()
}).strict();

const restoreRevisionSchema = z.object({
  sourceRevisionId: z.string().uuid(),
  publishImmediately: z.boolean().optional().default(false),
  activationPolicy: z.enum(SCHEDULE_ACTIVATION_POLICIES).optional().default('APPLY_NEXT_BOUNDARY')
}).strict();

const overrideActionSchema = z.object({
  action: z.enum([
    'START_SCHEDULER',
    'STOP_SCHEDULER',
    'HOLD_CURRENT',
    'RELEASE_HOLD',
    'TAKE_NEXT',
    'SKIP_CURRENT',
    'MANUAL_TRIGGER_EVENT',
    'MANUAL_SOURCE_OVERRIDE',
    'RETURN_TO_SCHEDULE',
    'EMERGENCY_OVERRIDE',
    'CLEAR_EMERGENCY'
  ]),
  trackType: z.enum(SCHEDULE_TRACK_TYPES).optional().default('MAIN_VIDEO'),
  eventId: z.string().trim().max(100).nullable().optional(),
  overrideSourceId: z.string().trim().max(100).nullable().optional(),
  overrideDurationMs: z.number().int().min(1000).max(86400000).optional()
}).strict();

const stepSchedulerSchema = z.object({
  nowUtc: z.string().trim().max(64).optional()
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

channelSchedulerRouter.use('/channels/:channelId/scheduler', (_req, res, next) => {
  res.set({ 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' });
  next();
});

channelSchedulerRouter.get('/channels/:channelId/scheduler', authenticate, authorize('station:read'), async (req, res, next) => {
  try {
    if (!await requireChannelOwnership(req, res)) return;
    const { channelId } = req.params;
    const schedRepo = RepositoryFactory.getBroadcastSchedulerRepository();
    const [draft, published, revisions, executionState, asRun] = await Promise.all([
      schedRepo.getOrCreateDraftRevision(channelId, req.user.organizationId, { id: req.user.id }),
      schedRepo.getActivePublishedRevision(channelId, req.user.organizationId),
      schedRepo.listRevisions(channelId, req.user.organizationId),
      schedRepo.getExecutionState(channelId, req.user.organizationId),
      schedRepo.listAsRunRecords(channelId, req.user.organizationId, { limit: 50 })
    ]);

    const windowStartMs = req.query.windowStartUtc ? Date.parse(String(req.query.windowStartUtc)) : Date.now() - 3600000;
    const windowEndMs = req.query.windowEndUtc ? Date.parse(String(req.query.windowEndUtc)) : windowStartMs + 24 * 3600000;
    const activeForExpansion = draft || published;
    let expandedOccurrences = [];
    if (activeForExpansion && Number.isFinite(windowStartMs) && Number.isFinite(windowEndMs) && windowEndMs > windowStartMs) {
      try {
        expandedOccurrences = expandScheduleOccurrences(activeForExpansion.events, {
          timezone: activeForExpansion.timezone || 'UTC',
          windowStartMs,
          windowEndMs
        });
      } catch {
        expandedOccurrences = [];
      }
    }

    res.json({
      success: true,
      data: {
        channelId,
        draft,
        published,
        revisions,
        executionState,
        expandedOccurrences,
        asRun
      }
    });
  } catch (error) {
    next(error);
  }
});

channelSchedulerRouter.put('/channels/:channelId/scheduler/draft', authenticate, authorize('schedule:manage'), validateBody(saveDraftSchema), async (req, res, next) => {
  try {
    if (!await requireChannelOwnership(req, res)) return;
    const { channelId } = req.params;
    const schedRepo = RepositoryFactory.getBroadcastSchedulerRepository();
    const saved = await schedRepo.saveDraftRevision(channelId, req.user.organizationId, req.body, {
      id: req.user.id,
      ipAddress: req.ip
    });
    res.json({ success: true, data: saved });
  } catch (error) {
    next(error);
  }
});

channelSchedulerRouter.post('/channels/:channelId/scheduler/validate', authenticate, authorize('schedule:manage'), async (req, res, next) => {
  try {
    if (!await requireChannelOwnership(req, res)) return;
    const { channelId } = req.params;
    const schedRepo = RepositoryFactory.getBroadcastSchedulerRepository();
    const draft = await schedRepo.getOrCreateDraftRevision(channelId, req.user.organizationId, { id: req.user.id });

    const windowStartMs = req.body?.windowStartUtc ? Date.parse(String(req.body.windowStartUtc)) : undefined;
    const windowEndMs = req.body?.windowEndUtc ? Date.parse(String(req.body.windowEndUtc)) : undefined;

    const summary = await validateScheduleRevision({
      organizationId: req.user.organizationId,
      channelId,
      timezone: draft.timezone || 'UTC',
      events: draft.events,
      windowStartMs,
      windowEndMs
    });

    const updated = await schedRepo.markRevisionValidated(draft.id, req.user.organizationId, summary, {
      id: req.user.id,
      ipAddress: req.ip
    });
    res.json({ success: true, data: { revision: updated, validation: summary } });
  } catch (error) {
    next(error);
  }
});

channelSchedulerRouter.post('/channels/:channelId/scheduler/publish', authenticate, authorize('schedule:publish'), validateBody(publishScheduleSchema), async (req, res, next) => {
  try {
    if (!await requireChannelOwnership(req, res)) return;
    const { channelId } = req.params;
    const schedRepo = RepositoryFactory.getBroadcastSchedulerRepository();
    const target = req.body.revisionId
      ? await schedRepo.getRevisionById(req.body.revisionId, req.user.organizationId)
      : await schedRepo.getOrCreateDraftRevision(channelId, req.user.organizationId, { id: req.user.id });

    if (!target || target.channelId !== channelId) {
      return res.status(404).json({ success: false, error: 'Schedule revision not found' });
    }

    const validation = await validateScheduleRevision({
      organizationId: req.user.organizationId,
      channelId,
      timezone: target.timezone || 'UTC',
      events: target.events
    });

    if (!validation.valid) {
      return res.status(409).json({
        success: false,
        error: `Cannot publish schedule with ${validation.errors.length} blocking validation error(s)`,
        details: validation
      });
    }

    const published = await schedRepo.publishRevision(
      channelId,
      req.user.organizationId,
      {
        revisionId: target.id,
        expectedRevisionNumber: req.body.expectedRevisionNumber,
        activationPolicy: req.body.activationPolicy,
        effectiveFromUtc: req.body.effectiveFromUtc,
        validationSummary: validation
      },
      { id: req.user.id, ipAddress: req.ip }
    );

    const execState = await schedRepo.getExecutionState(channelId, req.user.organizationId);
    const policy = req.body.activationPolicy || 'APPLY_NEXT_BOUNDARY';
    const hasRunningMain = Boolean(
      execState.currentTrackStates?.MAIN_VIDEO || execState.currentTrackStates?.LIVE_CAMERA_ROTATION
    );

    if (
      policy === 'APPLY_IMMEDIATELY_SAFE' ||
      policy === 'REPLACE_CURRENT_AUTHORIZED' ||
      (!hasRunningMain && policy !== 'APPLY_FUTURE_TIME')
    ) {
      await schedRepo.updateExecutionState(channelId, req.user.organizationId, {
        activeRevisionId: published.id,
        activeRevisionNumber: published.revisionNumber,
        timezone: published.timezone || 'UTC',
        pendingRevisionId: null,
        pendingActivationPolicy: null,
        pendingEffectiveAtUtc: null
      });
    } else {
      await schedRepo.updateExecutionState(channelId, req.user.organizationId, {
        pendingRevisionId: published.id,
        pendingActivationPolicy: policy,
        pendingEffectiveAtUtc: req.body.effectiveFromUtc || null
      });
    }

    res.json({ success: true, data: { published, validation } });
  } catch (error) {
    next(error);
  }
});

channelSchedulerRouter.post('/channels/:channelId/scheduler/restore', authenticate, authorize('schedule:publish'), validateBody(restoreRevisionSchema), async (req, res, next) => {
  try {
    if (!await requireChannelOwnership(req, res)) return;
    const { channelId } = req.params;
    const schedRepo = RepositoryFactory.getBroadcastSchedulerRepository();
    const sourceRev = await schedRepo.getRevisionById(req.body.sourceRevisionId, req.user.organizationId);
    if (!sourceRev || sourceRev.channelId !== channelId) {
      return res.status(404).json({ success: false, error: 'Source schedule revision not found' });
    }

    const restoredDraft = await schedRepo.saveDraftRevision(
      channelId,
      req.user.organizationId,
      {
        name: `${sourceRev.name} (Restored from v${sourceRev.revisionNumber})`,
        timezone: sourceRev.timezone,
        activationPolicy: req.body.activationPolicy,
        gapPolicy: sourceRev.gapPolicy,
        gapFallbackAssetId: sourceRev.gapFallbackAssetId,
        gapFallbackSourceId: sourceRev.gapFallbackSourceId,
        gapFallbackPlaylistId: sourceRev.gapFallbackPlaylistId,
        events: sourceRev.events,
        templates: sourceRev.templates
      },
      { id: req.user.id, ipAddress: req.ip }
    );

    if (!req.body.publishImmediately) {
      return res.json({ success: true, data: { draft: restoredDraft } });
    }

    const validation = await validateScheduleRevision({
      organizationId: req.user.organizationId,
      channelId,
      timezone: restoredDraft.timezone,
      events: restoredDraft.events
    });
    if (!validation.valid) {
      return res.status(409).json({
        success: false,
        error: 'Restored revision failed current validation checks',
        details: validation
      });
    }

    const published = await schedRepo.publishRevision(
      channelId,
      req.user.organizationId,
      {
        revisionId: restoredDraft.id,
        activationPolicy: req.body.activationPolicy,
        validationSummary: validation
      },
      { id: req.user.id, ipAddress: req.ip }
    );
    await schedRepo.updateExecutionState(channelId, req.user.organizationId, {
      activeRevisionId: published.id,
      activeRevisionNumber: published.revisionNumber,
      timezone: published.timezone
    });

    res.json({ success: true, data: { published, validation } });
  } catch (error) {
    next(error);
  }
});

channelSchedulerRouter.post('/channels/:channelId/scheduler/step', authenticate, authorize('station:control'), validateBody(stepSchedulerSchema), async (req, res, next) => {
  try {
    if (!await requireChannelOwnership(req, res)) return;
    const { channelId } = req.params;
    const nowMs = req.body.nowUtc ? Date.parse(req.body.nowUtc) : Date.now();
    if (!Number.isFinite(nowMs)) {
      return res.status(400).json({ success: false, error: 'Invalid nowUtc timestamp' });
    }
    const executor = multiChannelScheduler.getExecutor(channelId, req.user.organizationId);
    const execState = await executor.step(nowMs);
    const asRun = await RepositoryFactory.getBroadcastSchedulerRepository().listAsRunRecords(
      channelId,
      req.user.organizationId,
      { limit: 30 }
    );
    res.json({ success: true, data: { executionState: execState, asRun } });
  } catch (error) {
    next(error);
  }
});

channelSchedulerRouter.post('/channels/:channelId/scheduler/control', authenticate, authorize('station:control'), validateBody(overrideActionSchema), (req, res, next) => {
  if (req.body.action === 'EMERGENCY_OVERRIDE' || req.body.action === 'CLEAR_EMERGENCY') {
    return authorize('broadcast:emergency')(req, res, next);
  }
  next();
}, async (req, res, next) => {
  try {
    if (!await requireChannelOwnership(req, res)) return;
    const { channelId } = req.params;
    const { action, trackType, eventId, overrideSourceId, overrideDurationMs } = req.body;
    const schedRepo = RepositoryFactory.getBroadcastSchedulerRepository();
    const playoutRepo = RepositoryFactory.getChannelPlayoutRepository();
    const videoSourcesRepo = RepositoryFactory.getVideoSourceRepository();
    const mediaRepo = RepositoryFactory.getMediaRepository();
    const executor = multiChannelScheduler.getExecutor(channelId, req.user.organizationId);
    const { multiChannelPlayout } = await import('../../infrastructure/playout/channel-playout-supervisor.js');
    const playoutInst = multiChannelPlayout.getInstance(channelId, req.user.organizationId);
    let execState = await schedRepo.getExecutionState(channelId, req.user.organizationId);
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();

    if (action === 'START_SCHEDULER') {
      executor.startLoop(250);
      execState = await schedRepo.updateExecutionState(channelId, req.user.organizationId, {
        schedulerRunning: true
      });
    } else if (action === 'STOP_SCHEDULER') {
      executor.stopLoop();
      execState = await schedRepo.updateExecutionState(channelId, req.user.organizationId, {
        schedulerRunning: false
      });
    } else if (action === 'HOLD_CURRENT') {
      execState = await schedRepo.updateExecutionState(channelId, req.user.organizationId, {
        holdActive: true
      });
    } else if (action === 'RELEASE_HOLD') {
      execState = await schedRepo.updateExecutionState(channelId, req.user.organizationId, {
        holdActive: false
      });
    } else if (action === 'SKIP_CURRENT' || action === 'TAKE_NEXT') {
      const trackStates = { ...(execState.currentTrackStates || {}) };
      const current = trackStates[trackType];
      if (current) {
        await schedRepo.updateAsRunRecord(current.asRunId, req.user.organizationId, {
          actualEndUtc: nowIso,
          actualDurationMs: Math.max(0, nowMs - current.actualStartMs),
          status: 'SKIPPED_BY_OPERATOR',
          interruptionReason: `Operator ${action}`
        });
        delete trackStates[trackType];
        execState = await schedRepo.updateExecutionState(channelId, req.user.organizationId, {
          currentTrackStates: trackStates
        });
      }
      if (action === 'TAKE_NEXT') {
        execState = await executor.step(nowMs);
      }
    } else if (action === 'MANUAL_TRIGGER_EVENT') {
      const activeRev = execState.activeRevisionId
        ? await schedRepo.getRevisionById(execState.activeRevisionId, req.user.organizationId)
        : await schedRepo.getActivePublishedRevision(channelId, req.user.organizationId);
      const ev = activeRev?.events?.find(e => e.id === eventId);
      if (!ev) {
        return res.status(404).json({ success: false, error: 'Manual trigger event not found in active schedule' });
      }
      const durationMs = Number(ev.durationMs || 60000);
      const occ = {
        ...ev,
        occurrenceId: `${ev.id}@manual-${nowMs}`,
        plannedStartMs: nowMs,
        plannedEndMs: nowMs + durationMs,
        plannedStartUtc: nowIso,
        plannedEndUtc: new Date(nowMs + durationMs).toISOString()
      };
      const outcome = await executor._dispatchOccurrenceToEngine(occ, activeRev, playoutInst, 0);
      const asRun = await schedRepo.createAsRunRecord({
        organizationId: req.user.organizationId,
        channelId,
        revisionId: activeRev.id,
        revisionNumber: activeRev.revisionNumber,
        eventId: ev.id,
        occurrenceId: occ.occurrenceId,
        trackType: ev.trackType,
        executionMode: 'MANUAL_TRIGGER',
        title: ev.title,
        category: 'MANUAL_TRIGGER',
        mediaAssetId: ev.mediaAssetId || null,
        videoSourceId: ev.videoSourceId || null,
        audioSourceId: ev.audioSourceId || null,
        plannedStartUtc: nowIso,
        actualStartUtc: nowIso,
        plannedEndUtc: occ.plannedEndUtc,
        plannedDurationMs: durationMs,
        status: outcome.ok ? 'RUNNING' : 'FAILED_TO_START',
        workerConfirmed: outcome.workerConfirmed,
        details: { manualTriggerBy: req.user.id, ...outcome.details }
      });
      const trackStates = { ...(execState.currentTrackStates || {}) };
      if (outcome.ok) {
        trackStates[ev.trackType] = {
          eventId: ev.id,
          occurrenceId: occ.occurrenceId,
          asRunId: asRun.id,
          title: ev.title,
          trackType: ev.trackType,
          executionMode: 'MANUAL_TRIGGER',
          mediaAssetId: ev.mediaAssetId || null,
          videoSourceId: ev.videoSourceId || null,
          audioSourceId: ev.audioSourceId || null,
          plannedStartMs: nowMs,
          plannedEndMs: nowMs + durationMs,
          actualStartMs: nowMs,
          resumeOffsetMs: 0
        };
      }
      execState = await schedRepo.updateExecutionState(channelId, req.user.organizationId, {
        currentTrackStates: trackStates
      });
    } else if (action === 'MANUAL_SOURCE_OVERRIDE') {
      if (!overrideSourceId) {
        return res.status(400).json({ success: false, error: 'overrideSourceId is required for MANUAL_SOURCE_OVERRIDE' });
      }
      // Validate ownership and channel scope of overrideSourceId
      const cfg = await playoutRepo.getChannelConfig(channelId, req.user.organizationId);
      const inCameraSeq = (cfg.cameraSequence || []).some(c => c && (c.sourceId === overrideSourceId || c.id === overrideSourceId));
      const vSrc = !inCameraSeq ? await videoSourcesRepo.findSourceById(overrideSourceId, req.user.organizationId) : null;
      if (vSrc && vSrc.stationId && vSrc.stationId !== channelId) {
        return res.status(403).json({ success: false, error: 'Video source belongs to another channel' });
      }
      const mAsset = (!inCameraSeq && !vSrc) ? await mediaRepo.findAssetById(overrideSourceId, req.user.organizationId) : null;
      if (!inCameraSeq && !vSrc && !mAsset) {
        return res.status(404).json({ success: false, error: 'Override source or media asset not found in organization' });
      }

      const { outcome } = await playoutInst.triggerManualSourceOverride(
        { sourceId: overrideSourceId },
        { id: req.user.id, ipAddress: req.ip }
      );
      const expiresUtc = overrideDurationMs ? new Date(nowMs + overrideDurationMs).toISOString() : null;
      const asRun = await schedRepo.createAsRunRecord({
        organizationId: req.user.organizationId,
        channelId,
        revisionId: execState.activeRevisionId || null,
        revisionNumber: execState.activeRevisionNumber || 0,
        eventId: `manual-override:${overrideSourceId}`,
        occurrenceId: `manual-override:${overrideSourceId}@${nowMs}`,
        trackType,
        executionMode: 'MANUAL_TRIGGER',
        title: `Manual Source Override (${vSrc?.name || mAsset?.title || overrideSourceId})`,
        category: 'MANUAL_OVERRIDE',
        mediaAssetId: mAsset?.id || vSrc?.mediaAssetId || null,
        videoSourceId: vSrc?.id || null,
        plannedStartUtc: nowIso,
        actualStartUtc: nowIso,
        plannedEndUtc: expiresUtc || new Date(nowMs + 3600000).toISOString(),
        plannedDurationMs: overrideDurationMs || 3600000,
        status: outcome.fallbackActivated ? 'FALLBACK_ACTIVE' : 'MANUAL_OVERRIDE',
        interruptionReason: outcome.reason || null,
        workerConfirmed: outcome.workerConfirmed,
        details: { overrideSourceId, ...outcome }
      });

      execState = await schedRepo.updateExecutionState(channelId, req.user.organizationId, {
        manualOverrideActive: true,
        overrideSourceId,
        overrideExpiresAtUtc: expiresUtc,
        interruptedProgramState: {
          ...(execState.interruptedProgramState || {}),
          manualOverrideAsRunId: asRun.id,
          manualOverrideStartedAtMs: nowMs
        }
      });
    } else if (action === 'RETURN_TO_SCHEDULE') {
      const ovAsRunId = execState.interruptedProgramState?.manualOverrideAsRunId;
      const ovStartMs = execState.interruptedProgramState?.manualOverrideStartedAtMs || nowMs;
      if (ovAsRunId) {
        await schedRepo.updateAsRunRecord(ovAsRunId, req.user.organizationId, {
          actualEndUtc: nowIso,
          actualDurationMs: Math.max(0, nowMs - ovStartMs),
          status: 'COMPLETED',
          interruptionReason: 'RETURNED_TO_SCHEDULE'
        }).catch(() => {});
      }
      if (execState.emergencyOverrideActive) {
        await playoutInst.triggerEmergencySwitch({ enabled: false }, { id: req.user.id, ipAddress: req.ip });
      }
      const nextInterrupted = { ...(execState.interruptedProgramState || {}) };
      delete nextInterrupted.manualOverrideAsRunId;
      delete nextInterrupted.manualOverrideStartedAtMs;

      // Clear active primary video track states so step(nowMs) re-dispatches the currently due scheduled program to the engine
      const nextTracks = { ...(execState.currentTrackStates || {}) };
      const activePrimary = nextTracks.MAIN_VIDEO || nextTracks.LIVE_CAMERA_ROTATION;
      if (activePrimary && playoutInst.proc && !playoutInst.proc.killed) {
        const activeRev = execState.activeRevisionId
          ? await schedRepo.getRevisionById(execState.activeRevisionId, req.user.organizationId)
          : await schedRepo.getActivePublishedRevision(channelId, req.user.organizationId);
        if (activeRev) {
          const resumeSeek = activePrimary.trackType === 'MAIN_VIDEO'
            ? Math.max(0, nowMs - activePrimary.actualStartMs)
            : 0;
          await executor._dispatchOccurrenceToEngine(
            {
              id: activePrimary.eventId,
              title: activePrimary.title,
              trackType: activePrimary.trackType,
              executionMode: activePrimary.executionMode,
              mediaAssetId: activePrimary.mediaAssetId,
              videoSourceId: activePrimary.videoSourceId,
              plannedStartMs: activePrimary.plannedStartMs,
              plannedEndMs: activePrimary.plannedEndMs
            },
            activeRev,
            playoutInst,
            resumeSeek
          );
        }
      }

      execState = await schedRepo.updateExecutionState(channelId, req.user.organizationId, {
        manualOverrideActive: false,
        emergencyOverrideActive: false,
        holdActive: false,
        overrideSourceId: null,
        overrideExpiresAtUtc: null,
        interruptedProgramState: nextInterrupted
      });
      execState = await executor.step(nowMs);
    } else if (action === 'EMERGENCY_OVERRIDE') {
      // Validate optional emergency override source ownership if a specific UUID/source was supplied
      if (overrideSourceId && overrideSourceId !== 'emergency:slate') {
        const cfg = await playoutRepo.getChannelConfig(channelId, req.user.organizationId);
        const inCameraSeq = (cfg.cameraSequence || []).some(c => c && (c.sourceId === overrideSourceId || c.id === overrideSourceId));
        const vSrc = !inCameraSeq ? await videoSourcesRepo.findSourceById(overrideSourceId, req.user.organizationId) : null;
        if (vSrc && vSrc.stationId && vSrc.stationId !== channelId) {
          return res.status(403).json({ success: false, error: 'Emergency video source belongs to another channel' });
        }
        const mAsset = (!inCameraSeq && !vSrc) ? await mediaRepo.findAssetById(overrideSourceId, req.user.organizationId) : null;
        if (!inCameraSeq && !vSrc && !mAsset) {
          // Non-existent emergency source triggers emergency fallback slate rather than failing the emergency cut
          await playoutInst.triggerEmergencySwitch({ enabled: true, emergencySourceId: null }, { id: req.user.id, ipAddress: req.ip });
        } else {
          await playoutInst.triggerEmergencySwitch({ enabled: true, emergencySourceId: overrideSourceId }, { id: req.user.id, ipAddress: req.ip });
        }
      } else {
        await playoutInst.triggerEmergencySwitch({ enabled: true, emergencySourceId: null }, { id: req.user.id, ipAddress: req.ip });
      }

      const emAsRun = await schedRepo.createAsRunRecord({
        organizationId: req.user.organizationId,
        channelId,
        revisionId: execState.activeRevisionId || null,
        revisionNumber: execState.activeRevisionNumber || 0,
        eventId: `emergency-override:${overrideSourceId || 'slate'}`,
        occurrenceId: `emergency-override@${nowMs}`,
        trackType: 'MAIN_VIDEO',
        executionMode: 'EMERGENCY_OVERRIDE',
        title: `Emergency Broadcast Override (${overrideSourceId || 'emergency:slate'})`,
        category: 'EMERGENCY_OVERRIDE',
        plannedStartUtc: nowIso,
        actualStartUtc: nowIso,
        plannedEndUtc: new Date(nowMs + 3600000).toISOString(),
        plannedDurationMs: 3600000,
        status: 'EMERGENCY_OVERRIDE',
        workerConfirmed: Boolean(playoutInst.proc && !playoutInst.proc.killed),
        details: { overrideSourceId: overrideSourceId || 'emergency:slate', triggeredBy: req.user.id }
      });

      execState = await schedRepo.updateExecutionState(channelId, req.user.organizationId, {
        emergencyOverrideActive: true,
        overrideSourceId: overrideSourceId || 'emergency:slate',
        interruptedProgramState: {
          ...(execState.interruptedProgramState || {}),
          emergencyAsRunId: emAsRun.id,
          emergencyStartedAtMs: nowMs
        }
      });
    } else if (action === 'CLEAR_EMERGENCY') {
      const emAsRunId = execState.interruptedProgramState?.emergencyAsRunId;
      const emStartMs = execState.interruptedProgramState?.emergencyStartedAtMs || nowMs;
      if (emAsRunId) {
        await schedRepo.updateAsRunRecord(emAsRunId, req.user.organizationId, {
          actualEndUtc: nowIso,
          actualDurationMs: Math.max(0, nowMs - emStartMs),
          status: 'COMPLETED',
          interruptionReason: 'EMERGENCY_CLEARED'
        }).catch(() => {});
      }
      await playoutInst.triggerEmergencySwitch({ enabled: false }, { id: req.user.id, ipAddress: req.ip });
      const nextInterrupted = { ...(execState.interruptedProgramState || {}) };
      delete nextInterrupted.emergencyAsRunId;
      delete nextInterrupted.emergencyStartedAtMs;
      execState = await schedRepo.updateExecutionState(channelId, req.user.organizationId, {
        emergencyOverrideActive: false,
        overrideSourceId: null,
        interruptedProgramState: nextInterrupted
      });
      execState = await executor.step(nowMs);
    }

    await RepositoryFactory.getAuditRepository().create({
      organizationId: req.user.organizationId,
      userId: req.user.id,
      action: `SCHEDULER_${action}`,
      resourceType: 'ChannelSchedulerExecutionState',
      resourceId: channelId,
      details: { channelId, action, trackType, overrideSourceId: overrideSourceId || null },
      ipAddress: req.ip
    });

    res.json({ success: true, data: execState });
  } catch (error) {
    next(error);
  }
});

channelSchedulerRouter.get('/channels/:channelId/scheduler/as-run', authenticate, authorize('station:read'), async (req, res, next) => {
  try {
    if (!await requireChannelOwnership(req, res)) return;
    const { channelId } = req.params;
    const records = await RepositoryFactory.getBroadcastSchedulerRepository().listAsRunRecords(
      channelId,
      req.user.organizationId,
      {
        trackType: req.query.trackType ? String(req.query.trackType) : '',
        status: req.query.status ? String(req.query.status) : '',
        limit: req.query.limit ? Number(req.query.limit) : 100
      }
    );

    if (req.query.format === 'csv') {
      const header = 'id,channelId,revisionNumber,eventId,occurrenceId,trackType,executionMode,title,plannedStartUtc,actualStartUtc,plannedEndUtc,actualEndUtc,plannedDurationMs,actualDurationMs,status,interruptionReason,resumeOffsetMs,workerConfirmed';
      const rows = records.map(r => [
        csvTextCell(r.id),
        csvTextCell(r.channelId),
        csvTextCell(String(r.revisionNumber)),
        csvTextCell(r.eventId),
        csvTextCell(r.occurrenceId),
        csvTextCell(r.trackType),
        csvTextCell(r.executionMode),
        csvTextCell(r.title),
        csvTextCell(r.plannedStartUtc),
        csvTextCell(r.actualStartUtc),
        csvTextCell(r.plannedEndUtc),
        csvTextCell(r.actualEndUtc || ''),
        csvTextCell(String(r.plannedDurationMs)),
        csvTextCell(r.actualDurationMs != null ? String(r.actualDurationMs) : ''),
        csvTextCell(r.status),
        csvTextCell(r.interruptionReason || ''),
        csvTextCell(String(r.resumeOffsetMs || 0)),
        csvTextCell(String(r.workerConfirmed))
      ].join(','));
      res.set({
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="channel-${channelId}-as-run.csv"`
      });
      return res.send([header, ...rows].join('\n'));
    }

    res.json({ success: true, data: records });
  } catch (error) {
    next(error);
  }
});

channelSchedulerRouter.get('/channels/:channelId/scheduler/epg', authenticate, authorize('station:read'), async (req, res, next) => {
  try {
    if (!await requireChannelOwnership(req, res)) return;
    const { channelId } = req.params;
    const windowStartMs = req.query.windowStartUtc ? Date.parse(String(req.query.windowStartUtc)) : Date.now();
    const windowEndMs = req.query.windowEndUtc ? Date.parse(String(req.query.windowEndUtc)) : windowStartMs + 24 * 3600000;
    const guide = await generateChannelEpgGuide(channelId, req.user.organizationId, { windowStartMs, windowEndMs });
    res.json({ success: true, data: guide });
  } catch (error) {
    next(error);
  }
});
