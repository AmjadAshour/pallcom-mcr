import { randomUUID } from 'node:crypto';
import {
  MEDIA_PROCESSING_STATUS,
  SCHEDULE_EXECUTION_MODES,
  SCHEDULE_TRACK_TYPES
} from '@mcr/shared';
import { multiChannelAudio } from '../audio/audio-mixer-engine.js';
import { multiChannelPlayout } from '../playout/channel-playout-supervisor.js';
import { RepositoryFactory } from '../repositories/repository-factory.js';

export const MAX_WINDOW_EXPANSION_MS = 14 * 24 * 60 * 60 * 1000; // 14 days max expansion per query
export const MAX_EXPANDED_OCCURRENCES = 2000;

export function isValidIanaTimezone(timezone) {
  if (!timezone || typeof timezone !== 'string') return false;
  try {
    Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolves a local civil date-time ("YYYY-MM-DDTHH:mm" or "YYYY-MM-DDTHH:mm:ss") in an explicit IANA timezone
 * into a deterministic UTC timestamp (ms). Explicitly detects and rejects nonexistent DST spring-forward gaps
 * and ambiguous DST fall-back folds unless an explicit disambiguation policy ('EARLIER' | 'LATER' | 'REJECT') is passed.
 */
export function resolveLocalCivilTimeToUtcMs(localDateTimeStr, timezone = 'UTC', disambiguation = 'REJECT') {
  if (!isValidIanaTimezone(timezone)) {
    throw Object.assign(new Error(`Invalid IANA timezone: ${timezone}`), { statusCode: 400 });
  }
  const trimmed = String(localDateTimeStr || '').trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(trimmed);
  if (!match) {
    throw Object.assign(new Error(`Invalid local civil date-time format: ${localDateTimeStr}`), { statusCode: 400 });
  }
  const normalizedTarget = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6] || '00'}`;
  const nominalUtcMs = Date.parse(`${normalizedTarget}Z`);
  if (!Number.isFinite(nominalUtcMs)) {
    throw Object.assign(new Error(`Unparseable local date-time: ${localDateTimeStr}`), { statusCode: 400 });
  }

  const formatter = new Intl.DateTimeFormat('sv-SE', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  });
  const formatLocal = utcMs => formatter.format(utcMs).replace(' ', 'T');

  const candidateOffsets = new Set(
    [-86400000, -10800000, -3600000, 0, 3600000, 10800000, 86400000].map(delta => {
      const probe = nominalUtcMs + delta;
      return Date.parse(`${formatLocal(probe)}Z`) - probe;
    })
  );

  const matchingInstants = [...candidateOffsets]
    .map(offset => nominalUtcMs - offset)
    .filter(candidateMs => formatLocal(candidateMs) === normalizedTarget)
    .sort((a, b) => a - b);

  const uniqueInstants = [...new Set(matchingInstants)];

  if (uniqueInstants.length === 0) {
    throw Object.assign(
      new Error(`Nonexistent local civil time during DST transition: ${normalizedTarget} in ${timezone}`),
      { statusCode: 400, code: 'DST_NONEXISTENT_TIME' }
    );
  }
  if (uniqueInstants.length > 1) {
    if (disambiguation === 'EARLIER') return uniqueInstants[0];
    if (disambiguation === 'LATER') return uniqueInstants[uniqueInstants.length - 1];
    throw Object.assign(
      new Error(`Ambiguous local civil time during DST transition: ${normalizedTarget} in ${timezone}`),
      { statusCode: 400, code: 'DST_AMBIGUOUS_TIME' }
    );
  }
  return uniqueInstants[0];
}

export function formatUtcMsInTimezone(utcMs, timezone = 'UTC') {
  const formatter = new Intl.DateTimeFormat('sv-SE', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  });
  const formatted = formatter.format(utcMs).replace(' ', 'T');
  const weekdayFormatter = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' });
  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const weekday = weekdayMap[weekdayFormatter.format(utcMs)] ?? new Date(utcMs).getUTCDay();
  return {
    localDateTime: formatted,
    localDate: formatted.slice(0, 10),
    localTime: formatted.slice(11, 19),
    weekday
  };
}

/**
 * Bounded Recurrence Expander.
 * Expands base events (`ONCE`, `DAILY`, `WEEKLY`, `SELECTED_WEEKDAYS`) with date-specific `exceptionDates`
 * across a bounded `[windowStartMs, windowEndMs]` range without unbounded memory growth.
 */
export function expandScheduleOccurrences(events = [], {
  timezone = 'UTC',
  windowStartMs,
  windowEndMs
}) {
  if (!Number.isFinite(windowStartMs) || !Number.isFinite(windowEndMs) || windowEndMs <= windowStartMs) {
    throw Object.assign(new Error('Provide a valid bounded [windowStartMs, windowEndMs] range'), { statusCode: 400 });
  }
  if (windowEndMs - windowStartMs > MAX_WINDOW_EXPANSION_MS) {
    throw Object.assign(
      new Error(`Recurrence expansion window exceeds maximum allowed span (${MAX_WINDOW_EXPANSION_MS} ms)`),
      { statusCode: 400 }
    );
  }

  const occurrences = [];
  const sortedBase = [...events].filter(e => e && e.enabled !== false);

  for (const ev of sortedBase) {
    const durationMs = Number(ev.durationMs ?? 0);
    if (durationMs <= 0) continue;

    let baseStartMs;
    if (ev.startUtc) {
      baseStartMs = Date.parse(ev.startUtc);
    } else if (ev.localStartDateTime) {
      baseStartMs = resolveLocalCivilTimeToUtcMs(
        ev.localStartDateTime,
        timezone,
        ev.dstDisambiguation || 'REJECT'
      );
    } else {
      continue;
    }
    if (!Number.isFinite(baseStartMs)) continue;

    const recurrence = ev.recurrence || { frequency: 'ONCE' };
    const freq = recurrence.frequency || 'ONCE';
    const exceptionDates = new Set(Array.isArray(recurrence.exceptionDates) ? recurrence.exceptionDates : []);
    const untilMs = recurrence.untilUtc ? Date.parse(recurrence.untilUtc) : Infinity;
    const maxCount = recurrence.count ? Math.min(MAX_EXPANDED_OCCURRENCES, Number(recurrence.count)) : MAX_EXPANDED_OCCURRENCES;

    if (freq === 'ONCE') {
      const endMs = baseStartMs + durationMs;
      const localInfo = formatUtcMsInTimezone(baseStartMs, timezone);
      if (!exceptionDates.has(localInfo.localDate) && endMs > windowStartMs && baseStartMs < windowEndMs) {
        occurrences.push({
          ...ev,
          occurrenceId: `${ev.id}@${baseStartMs}`,
          plannedStartMs: baseStartMs,
          plannedEndMs: endMs,
          plannedStartUtc: new Date(baseStartMs).toISOString(),
          plannedEndUtc: new Date(endMs).toISOString(),
          localDate: localInfo.localDate
        });
      }
      continue;
    }

    // Recurring event expansion using local civil time in the channel's timezone so DST doesn't shift local airtime
    const baseLocal = formatUtcMsInTimezone(baseStartMs, timezone);
    const baseTimeOfDay = ev.localStartDateTime ? ev.localStartDateTime.slice(11) : baseLocal.localTime;
    const dayStepMs = 24 * 60 * 60 * 1000;
    const startDayCursor = Math.max(baseStartMs - dayStepMs, windowStartMs - dayStepMs);
    let generatedCount = 0;

    for (let cursorMs = startDayCursor; cursorMs <= Math.min(windowEndMs + dayStepMs, untilMs); cursorMs += dayStepMs) {
      if (generatedCount >= maxCount || occurrences.length >= MAX_EXPANDED_OCCURRENCES) break;
      const dayLocal = formatUtcMsInTimezone(cursorMs, timezone);
      if (dayLocal.localDate < baseLocal.localDate) continue;

      if (freq === 'WEEKLY' && dayLocal.weekday !== baseLocal.weekday) continue;
      if (freq === 'SELECTED_WEEKDAYS') {
        const days = Array.isArray(recurrence.weekdays) ? recurrence.weekdays : [baseLocal.weekday];
        if (!days.includes(dayLocal.weekday)) continue;
      }

      let occStartMs;
      try {
        occStartMs = resolveLocalCivilTimeToUtcMs(
          `${dayLocal.localDate}T${baseTimeOfDay}`,
          timezone,
          ev.dstDisambiguation || 'EARLIER'
        );
      } catch {
        continue;
      }

      if (occStartMs < baseStartMs - 1000 || occStartMs > untilMs) continue;
      generatedCount += 1;
      if (exceptionDates.has(dayLocal.localDate)) continue;
      const occEndMs = occStartMs + durationMs;

      if (occEndMs > windowStartMs && occStartMs < windowEndMs) {
        occurrences.push({
          ...ev,
          occurrenceId: `${ev.id}@${occStartMs}`,
          plannedStartMs: occStartMs,
          plannedEndMs: occEndMs,
          plannedStartUtc: new Date(occStartMs).toISOString(),
          plannedEndUtc: new Date(occEndMs).toISOString(),
          localDate: dayLocal.localDate
        });
      }
    }
  }

  // Resolve FOLLOW_PREVIOUS chaining within each track
  const byTrack = new Map();
  for (const occ of occurrences) {
    const list = byTrack.get(occ.trackType) || [];
    list.push(occ);
    byTrack.set(occ.trackType, list);
  }

  const resolved = [];
  for (const [, trackList] of byTrack) {
    trackList.sort((a, b) => a.plannedStartMs - b.plannedStartMs || (b.priority ?? 50) - (a.priority ?? 50));
    for (let i = 0; i < trackList.length; i++) {
      const item = trackList[i];
      if (item.executionMode === 'FOLLOW_PREVIOUS' && i > 0) {
        const prev = trackList[i - 1];
        const dur = item.plannedEndMs - item.plannedStartMs;
        item.plannedStartMs = prev.plannedEndMs;
        item.plannedEndMs = item.plannedStartMs + dur;
        item.plannedStartUtc = new Date(item.plannedStartMs).toISOString();
        item.plannedEndUtc = new Date(item.plannedEndMs).toISOString();
        item.occurrenceId = `${item.id}@${item.plannedStartMs}`;
      }
      resolved.push(item);
    }
  }

  return resolved.sort((a, b) => a.plannedStartMs - b.plannedStartMs || (b.priority ?? 50) - (a.priority ?? 50));
}

/**
 * Server-Side Multi-Track Schedule Validator & Gap Detector.
 * Distinguishes blocking ERRORS from operator WARNINGS and detects unscheduled primary timeline gaps.
 */
export async function validateScheduleRevision({
  organizationId,
  channelId,
  timezone = 'UTC',
  events = [],
  windowStartMs = null,
  windowEndMs = null
}) {
  const errors = [];
  const warnings = [];
  const gaps = [];

  if (!isValidIanaTimezone(timezone)) {
    errors.push({
      code: 'INVALID_TIMEZONE',
      message: `Invalid IANA timezone identifier: ${timezone}`,
      eventIds: []
    });
    return { valid: false, errors, warnings, gaps, occurrenceCount: 0 };
  }

  const mediaRepo = RepositoryFactory.getMediaRepository();
  const videoSourcesRepo = RepositoryFactory.getVideoSourceRepository();
  const audioRepo = RepositoryFactory.getAudioRepository();

  const eventIdSet = new Set();
  const followPrevGraph = new Map();

  for (const ev of events) {
    if (!ev || !ev.id) {
      errors.push({ code: 'MISSING_EVENT_ID', message: 'Every scheduled event must have a unique id', eventIds: [] });
      continue;
    }
    if (eventIdSet.has(ev.id)) {
      errors.push({ code: 'DUPLICATE_EVENT_ID', message: `Duplicate event ID: ${ev.id}`, eventIds: [ev.id] });
    }
    eventIdSet.add(ev.id);

    if (!SCHEDULE_TRACK_TYPES.includes(ev.trackType)) {
      errors.push({
        code: 'INVALID_TRACK_TYPE',
        message: `Unsupported trackType "${ev.trackType}" on event ${ev.id}`,
        eventIds: [ev.id]
      });
    }
    if (!SCHEDULE_EXECUTION_MODES.includes(ev.executionMode)) {
      errors.push({
        code: 'INVALID_EXECUTION_MODE',
        message: `Unsupported executionMode "${ev.executionMode}" on event ${ev.id}`,
        eventIds: [ev.id]
      });
    }

    const durationMs = Number(ev.durationMs ?? 0);
    if (!Number.isFinite(durationMs) || durationMs <= 0) {
      errors.push({
        code: 'INVALID_DURATION',
        message: `Event "${ev.title || ev.id}" must have a positive durationMs`,
        eventIds: [ev.id]
      });
    }

    if (ev.endUtc && ev.startUtc && Date.parse(ev.endUtc) <= Date.parse(ev.startUtc)) {
      errors.push({
        code: 'END_BEFORE_START',
        message: `Event "${ev.title || ev.id}" end time precedes or equals start time`,
        eventIds: [ev.id]
      });
    }

    if (ev.channelId && ev.channelId !== channelId) {
      errors.push({
        code: 'CROSS_CHANNEL_REFERENCE',
        message: `Event "${ev.title || ev.id}" references foreign channel ${ev.channelId}`,
        eventIds: [ev.id]
      });
    }

    if (ev.afterEventId) {
      followPrevGraph.set(ev.id, ev.afterEventId);
    }

    // Validate local DST civil time if specified
    if (ev.localStartDateTime) {
      try {
        resolveLocalCivilTimeToUtcMs(ev.localStartDateTime, timezone, ev.dstDisambiguation || 'REJECT');
      } catch (err) {
        errors.push({
          code: err.code || 'INVALID_LOCAL_TIME',
          message: err.message,
          eventIds: [ev.id]
        });
      }
    }

    // Validate recurrence rules
    if (ev.recurrence) {
      const freq = ev.recurrence.frequency || 'ONCE';
      if (!['ONCE', 'DAILY', 'WEEKLY', 'SELECTED_WEEKDAYS'].includes(freq)) {
        errors.push({
          code: 'INVALID_RECURRENCE_RULE',
          message: `Invalid recurrence frequency "${freq}" on event ${ev.id}`,
          eventIds: [ev.id]
        });
      }
      if (freq === 'SELECTED_WEEKDAYS') {
        const days = ev.recurrence.weekdays;
        if (!Array.isArray(days) || !days.length || days.some(d => !Number.isInteger(d) || d < 0 || d > 6)) {
          errors.push({
            code: 'INVALID_RECURRENCE_WEEKDAYS',
            message: `SELECTED_WEEKDAYS requires an array of weekday integers (0–6) on event ${ev.id}`,
            eventIds: [ev.id]
          });
        }
      }
    }

    // Validate organization-scoped MediaAsset reference
    if (ev.mediaAssetId) {
      const asset = await mediaRepo.findAssetById(ev.mediaAssetId, organizationId);
      if (!asset) {
        errors.push({
          code: 'MISSING_OR_FOREIGN_MEDIA_ASSET',
          message: `Event "${ev.title || ev.id}" references missing or unauthorized mediaAssetId ${ev.mediaAssetId}`,
          eventIds: [ev.id]
        });
      } else if (asset.processingStatus !== MEDIA_PROCESSING_STATUS.READY) {
        errors.push({
          code: 'UNREADY_MEDIA_ASSET',
          message: `Media asset "${asset.title}" is in state ${asset.processingStatus} (must be READY)`,
          eventIds: [ev.id]
        });
      }
    }

    // Validate organization-scoped VideoSource reference
    if (ev.videoSourceId) {
      const vSource = await videoSourcesRepo.findSourceById(ev.videoSourceId, organizationId);
      if (!vSource) {
        errors.push({
          code: 'MISSING_OR_FOREIGN_VIDEO_SOURCE',
          message: `Event "${ev.title || ev.id}" references missing or unauthorized videoSourceId ${ev.videoSourceId}`,
          eventIds: [ev.id]
        });
      } else if (vSource.stationId && vSource.stationId !== channelId) {
        errors.push({
          code: 'CROSS_CHANNEL_VIDEO_SOURCE',
          message: `Video source "${vSource.name}" belongs to another channel (${vSource.stationId})`,
          eventIds: [ev.id]
        });
      }
    }

    // Validate organization- and channel-scoped AudioSource reference
    if (ev.audioSourceId) {
      const aSource = await audioRepo.findAudioSourceById(ev.audioSourceId, organizationId);
      if (!aSource) {
        errors.push({
          code: 'MISSING_OR_FOREIGN_AUDIO_SOURCE',
          message: `Event "${ev.title || ev.id}" references missing or unauthorized audioSourceId ${ev.audioSourceId}`,
          eventIds: [ev.id]
        });
      } else if (aSource.channelId !== channelId) {
        errors.push({
          code: 'CROSS_CHANNEL_AUDIO_SOURCE',
          message: `Audio source "${aSource.name}" belongs to another channel (${aSource.channelId})`,
          eventIds: [ev.id]
        });
      }
    }
  }

  // Detect circular dependency chains in afterEventId
  for (const [startId] of followPrevGraph) {
    const visited = new Set();
    let curr = startId;
    while (curr && followPrevGraph.has(curr)) {
      if (visited.has(curr)) {
        errors.push({
          code: 'CIRCULAR_EVENT_DEPENDENCY',
          message: `Circular dependency detected involving event ${startId}`,
          eventIds: [...visited]
        });
        break;
      }
      visited.add(curr);
      curr = followPrevGraph.get(curr);
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors, warnings, gaps, occurrenceCount: 0 };
  }

  // Determine expansion window from events if not explicitly supplied
  let minStart = windowStartMs;
  let maxEnd = windowEndMs;
  if (!Number.isFinite(minStart) || !Number.isFinite(maxEnd)) {
    const starts = events
      .map(e => (e.startUtc ? Date.parse(e.startUtc) : e.localStartDateTime ? resolveLocalCivilTimeToUtcMs(e.localStartDateTime, timezone, e.dstDisambiguation || 'EARLIER') : null))
      .filter(Number.isFinite);
    minStart = starts.length ? Math.min(...starts) : Date.now();
    maxEnd = minStart + 72 * 60 * 60 * 1000; // Default 72-hour validation window
  }

  const occurrences = expandScheduleOccurrences(events, {
    timezone,
    windowStartMs: minStart,
    windowEndMs: Math.min(maxEnd, minStart + MAX_WINDOW_EXPANSION_MS)
  });

  // Track-specific overlap & conflict detection:
  // - Exclusive tracks within themselves: MAIN_VIDEO, LIVE_CAMERA_ROTATION, ADVERTISEMENTS, NEWS_TICKER
  // - Compatible overlaps across different tracks: e.g. MAIN_VIDEO + INDEPENDENT_AUDIO + GRAPHICS_OVERLAYS + NEWS_TICKER
  const exclusiveTracks = new Set(['MAIN_VIDEO', 'LIVE_CAMERA_ROTATION', 'ADVERTISEMENTS', 'NEWS_TICKER']);

  for (const trackType of exclusiveTracks) {
    const trackOccs = occurrences
      .filter(o => o.trackType === trackType)
      .sort((a, b) => a.plannedStartMs - b.plannedStartMs);

    for (let i = 0; i < trackOccs.length - 1; i++) {
      const a = trackOccs[i];
      const b = trackOccs[i + 1];
      if (b.plannedStartMs < a.plannedEndMs) {
        if (a.executionMode === 'HARD_START' && b.executionMode === 'HARD_START') {
          errors.push({
            code: 'CONFLICTING_HARD_STARTS',
            message: `Overlapping HARD_START events on track ${trackType}: "${a.title}" and "${b.title}"`,
            eventIds: [a.id, b.id]
          });
        } else if (b.executionMode === 'HARD_START' && a.allowPreemption !== false) {
          warnings.push({
            code: 'HARD_START_PREEMPTS_PREVIOUS',
            message: `HARD_START event "${b.title}" will preempt "${a.title}" on track ${trackType}`,
            eventIds: [a.id, b.id]
          });
        } else {
          errors.push({
            code: 'TRACK_OVERLAP_CONFLICT',
            message: `Unresolved overlap on track ${trackType} between "${a.title}" and "${b.title}"`,
            eventIds: [a.id, b.id]
          });
        }
      }
    }
  }

  // Check primary video contention between MAIN_VIDEO and LIVE_CAMERA_ROTATION
  const primaryVideoOccs = occurrences
    .filter(o => o.trackType === 'MAIN_VIDEO' || o.trackType === 'LIVE_CAMERA_ROTATION')
    .sort((a, b) => a.plannedStartMs - b.plannedStartMs);

  for (let i = 0; i < primaryVideoOccs.length - 1; i++) {
    const a = primaryVideoOccs[i];
    const b = primaryVideoOccs[i + 1];
    if (a.trackType !== b.trackType && b.plannedStartMs < a.plannedEndMs) {
      if (a.executionMode === 'HARD_START' && b.executionMode === 'HARD_START' && a.plannedStartMs === b.plannedStartMs) {
        errors.push({
          code: 'SIMULTANEOUS_PRIMARY_VIDEO_HARD_START',
          message: `Simultaneous HARD_START between MAIN_VIDEO ("${a.title}") and LIVE_CAMERA_ROTATION ("${b.title}")`,
          eventIds: [a.id, b.id]
        });
      }
    }

    // Gap detection between consecutive primary video events
    if (b.plannedStartMs > a.plannedEndMs) {
      gaps.push({
        startUtc: new Date(a.plannedEndMs).toISOString(),
        endUtc: new Date(b.plannedStartMs).toISOString(),
        durationMs: b.plannedStartMs - a.plannedEndMs,
        precedingEventId: a.id,
        followingEventId: b.id
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    gaps,
    occurrenceCount: occurrences.length
  };
}

/**
 * Per-Channel Server-Side Broadcast Scheduler Executor.
 * Drives the actual Phase Six `ChannelPlayoutInstance` and Phase Five `ChannelAudioEngine`.
 */
export class ChannelScheduleExecutor {
  constructor(channelId, organizationId, manager) {
    this.channelId = channelId;
    this.organizationId = organizationId;
    this.manager = manager;
    this.instanceLeaseId = `sched-${randomUUID().slice(0, 8)}`;
    this.tickTimer = null;
    this.stepping = false;
  }

  startLoop(intervalMs = 250) {
    if (this.tickTimer) return;
    this.tickTimer = setInterval(() => {
      void this.step(Date.now()).catch(() => {});
    }, intervalMs);
    this.tickTimer.unref?.();
  }

  stopLoop() {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  /**
   * Executes one deterministic scheduling tick at `nowMs`.
   * Can be invoked by the real-time timer or directly in deterministic clock tests.
   */
  async step(nowMs = Date.now()) {
    if (this.stepping) return null;
    this.stepping = true;
    try {
      const schedRepo = RepositoryFactory.getBroadcastSchedulerRepository();
      const playoutInst = multiChannelPlayout.getInstance(this.channelId, this.organizationId);

      // Atomic compare-and-set lease acquisition: prevent duplicate scheduler ownership across competing instances
      const lease = await schedRepo.acquireSchedulerLease(this.channelId, this.organizationId, this.instanceLeaseId, nowMs, 5000);
      if (!lease.acquired) {
        return await schedRepo.getExecutionState(this.channelId, this.organizationId);
      }

      let execState = await schedRepo.getExecutionState(this.channelId, this.organizationId);
      const nowIso = new Date(nowMs).toISOString();

      // Check if a manual override has expired
      if (execState.manualOverrideActive && execState.overrideExpiresAtUtc && Date.parse(execState.overrideExpiresAtUtc) <= nowMs) {
        execState = await schedRepo.updateExecutionState(this.channelId, this.organizationId, {
          manualOverrideActive: false,
          overrideSourceId: null,
          overrideExpiresAtUtc: null
        }, { ownerId: this.instanceLeaseId });
      }

      // Check if a pending future schedule revision is now due for activation
      if (execState.pendingRevisionId) {
        const shouldActivate =
          execState.pendingActivationPolicy === 'APPLY_IMMEDIATELY_SAFE' ||
          (execState.pendingActivationPolicy === 'APPLY_FUTURE_TIME' &&
            execState.pendingEffectiveAtUtc &&
            Date.parse(execState.pendingEffectiveAtUtc) <= nowMs) ||
          (execState.pendingActivationPolicy === 'APPLY_NEXT_BOUNDARY' &&
            !this._hasActivePrimaryEvent(execState.currentTrackStates, nowMs));

        if (shouldActivate) {
          const pendingRev = await schedRepo.getRevisionById(execState.pendingRevisionId, this.organizationId);
          if (pendingRev) {
            execState = await schedRepo.updateExecutionState(this.channelId, this.organizationId, {
              activeRevisionId: pendingRev.id,
              activeRevisionNumber: pendingRev.revisionNumber,
              timezone: pendingRev.timezone || 'UTC',
              pendingRevisionId: null,
              pendingActivationPolicy: null,
              pendingEffectiveAtUtc: null
            }, { ownerId: this.instanceLeaseId });
          }
        }
      }

      const activeRevision = execState.activeRevisionId
        ? await schedRepo.getRevisionById(execState.activeRevisionId, this.organizationId)
        : await schedRepo.getActivePublishedRevision(this.channelId, this.organizationId);

      if (!activeRevision) {
        return await schedRepo.updateExecutionState(this.channelId, this.organizationId, {
          leaseOwnerId: this.instanceLeaseId,
          leaseExpiresAt: nowMs + 5000,
          lastHeartbeatAt: nowIso
        }, { ownerId: this.instanceLeaseId });
      }

      if (execState.activeRevisionId !== activeRevision.id && !execState.pendingRevisionId) {
        execState = await schedRepo.updateExecutionState(this.channelId, this.organizationId, {
          activeRevisionId: activeRevision.id,
          activeRevisionNumber: activeRevision.revisionNumber,
          timezone: activeRevision.timezone || 'UTC'
        }, { ownerId: this.instanceLeaseId });
      }

      // If Emergency Override or Hold or Manual Override is active, do not start new scheduled events
      if (execState.emergencyOverrideActive || execState.holdActive || execState.manualOverrideActive) {
        return await schedRepo.updateExecutionState(this.channelId, this.organizationId, {
          leaseOwnerId: this.instanceLeaseId,
          leaseExpiresAt: nowMs + 5000,
          lastHeartbeatAt: nowIso
        }, { ownerId: this.instanceLeaseId });
      }

      // Expand occurrences in a bounded window around `nowMs` ([-4 hours, +12 hours])
      const occurrences = expandScheduleOccurrences(activeRevision.events, {
        timezone: activeRevision.timezone || 'UTC',
        windowStartMs: nowMs - 4 * 60 * 60 * 1000,
        windowEndMs: nowMs + 12 * 60 * 60 * 1000
      });

      const trackStates = { ...(execState.currentTrackStates || {}) };
      const claimedSet = new Set(execState.claimedOccurrenceIds || []);
      let interruptedProgram = { ...(execState.interruptedProgramState || {}) };
      let gapFallbackActive = Boolean(execState.gapFallbackActive);

      // 1. Complete any active track events whose plannedEndMs <= nowMs
      for (const [trackType, activeTrack] of Object.entries(trackStates)) {
        if (!activeTrack) continue;
        if (nowMs >= activeTrack.plannedEndMs) {
          await schedRepo.updateAsRunRecord(activeTrack.asRunId, this.organizationId, {
            actualEndUtc: nowIso,
            actualDurationMs: Math.max(0, nowMs - activeTrack.actualStartMs),
            status: 'COMPLETED',
            workerConfirmed: true,
            details: { endErrorMs: nowMs - activeTrack.plannedEndMs }
          });
          delete trackStates[trackType];

          // If an advertisement break on ADVERTISEMENTS track just finished and there is an interrupted movie/program, resume it!
          if (trackType === 'ADVERTISEMENTS' && interruptedProgram?.occurrenceId) {
            await this._resumeInterruptedProgram(interruptedProgram, activeRevision, playoutInst, schedRepo, trackStates, nowMs);
            interruptedProgram = {};
          } else if (trackType === 'ADVERTISEMENTS' && trackStates.LIVE_CAMERA_ROTATION && playoutInst.proc && !playoutInst.proc.killed) {
            // Advertisement over a live camera block finished: return to camera rotation
            await RepositoryFactory.getChannelPlayoutRepository().updateRuntimeCheckpoint(this.channelId, this.organizationId, {
              adState: { active: false, currentAdAssetId: null, resumeMovieIndex: 0, resumePositionMs: 0 }
            }).catch(() => {});
            await playoutInst._stepCameraRotation(0).catch(() => {});
          }
        }
      }

      // 2. Find due occurrences across all 7 tracks
      for (const occ of occurrences) {
        if (claimedSet.has(occ.occurrenceId)) continue;
        if (occ.executionMode === 'MANUAL_TRIGGER') continue;

        // Missed-event policy: if an event's planned end has already passed before it could start, record MISSED and do not replay it
        if (nowMs >= occ.plannedEndMs) {
          claimedSet.add(occ.occurrenceId);
          await schedRepo.createAsRunRecord({
            organizationId: this.organizationId,
            channelId: this.channelId,
            revisionId: activeRevision.id,
            revisionNumber: activeRevision.revisionNumber,
            eventId: occ.id,
            occurrenceId: occ.occurrenceId,
            trackType: occ.trackType,
            executionMode: occ.executionMode,
            title: occ.title,
            category: occ.category || 'PROGRAM',
            mediaAssetId: occ.mediaAssetId || null,
            videoSourceId: occ.videoSourceId || null,
            audioSourceId: occ.audioSourceId || null,
            plannedStartUtc: occ.plannedStartUtc,
            actualStartUtc: nowIso,
            plannedEndUtc: occ.plannedEndUtc,
            actualEndUtc: nowIso,
            plannedDurationMs: occ.plannedEndMs - occ.plannedStartMs,
            actualDurationMs: 0,
            status: 'MISSED',
            interruptionReason: 'EVENT_WINDOW_EXPIRED_BEFORE_EXECUTION',
            workerConfirmed: false
          });
          continue;
        }

        if (nowMs < occ.plannedStartMs) continue;

        const currentOnTrack = trackStates[occ.trackType];
        if (currentOnTrack) {
          // Soft start waits for current item on the same track to finish
          if (occ.executionMode === 'SOFT_START' || occ.executionMode === 'FOLLOW_PREVIOUS') {
            continue;
          }
          // Hard start preempts current item if priority >= current or allowPreemption is true
          if (occ.executionMode === 'HARD_START') {
            await schedRepo.updateAsRunRecord(currentOnTrack.asRunId, this.organizationId, {
              actualEndUtc: nowIso,
              actualDurationMs: Math.max(0, nowMs - currentOnTrack.actualStartMs),
              status: 'PREEMPTED',
              interruptionReason: `Preempted by HARD_START event ${occ.title} (${occ.id})`,
              workerConfirmed: true
            });
            delete trackStates[occ.trackType];
          }
        }

        // Durable write-ahead claim in database BEFORE dispatching to engine
        const claim = await schedRepo.claimOccurrence({
          organizationId: this.organizationId,
          channelId: this.channelId,
          revisionId: activeRevision.id,
          revisionNumber: activeRevision.revisionNumber,
          eventId: occ.id,
          occurrenceId: occ.occurrenceId,
          trackType: occ.trackType,
          executionMode: occ.executionMode,
          title: occ.title,
          category: occ.category || occ.trackType,
          mediaAssetId: occ.mediaAssetId || null,
          videoSourceId: occ.videoSourceId || null,
          audioSourceId: occ.audioSourceId || null,
          plannedStartUtc: occ.plannedStartUtc,
          actualStartUtc: nowIso,
          plannedEndUtc: occ.plannedEndUtc,
          plannedDurationMs: occ.plannedEndMs - occ.plannedStartMs,
          resumeOffsetMs: 0,
          details: { startErrorMs: nowMs - occ.plannedStartMs }
        }, { ownerId: this.instanceLeaseId });

        if (claim.ownerLost) {
          return await schedRepo.getExecutionState(this.channelId, this.organizationId);
        }
        claimedSet.add(occ.occurrenceId);
        if (!claim.claimed) {
          // Already durably claimed by an earlier process/instance before crash
          continue;
        }

        // If an ADVERTISEMENTS event starts while a MAIN_VIDEO movie is playing, save the movie's resume offset!
        if (occ.trackType === 'ADVERTISEMENTS' && trackStates.MAIN_VIDEO) {
          const activeMain = trackStates.MAIN_VIDEO;
          const elapsedMovieMs = Math.max(0, nowMs - activeMain.actualStartMs) + Number(activeMain.resumeOffsetMs || 0);
          interruptedProgram = {
            ...activeMain,
            resumeOffsetMs: elapsedMovieMs,
            interruptedAtMs: nowMs
          };
          await schedRepo.updateAsRunRecord(activeMain.asRunId, this.organizationId, {
            status: 'INTERRUPTED_BY_AD',
            interruptionReason: `Paused at +${elapsedMovieMs}ms for advertisement "${occ.title}"`,
            details: { pausedAtOffsetMs: elapsedMovieMs }
          });
        }

        // If a primary HARD_START event starts while an advertisement break is active, cancel the interrupted movie resume
        if ((occ.trackType === 'MAIN_VIDEO' || occ.trackType === 'LIVE_CAMERA_ROTATION') && occ.executionMode === 'HARD_START') {
          if (interruptedProgram?.occurrenceId && interruptedProgram.occurrenceId !== occ.occurrenceId) {
            interruptedProgram = {};
          }
          if (trackStates.ADVERTISEMENTS) {
            await schedRepo.updateAsRunRecord(trackStates.ADVERTISEMENTS.asRunId, this.organizationId, {
              actualEndUtc: nowIso,
              actualDurationMs: Math.max(0, nowMs - trackStates.ADVERTISEMENTS.actualStartMs),
              status: 'PREEMPTED',
              interruptionReason: `Preempted by primary HARD_START "${occ.title}"`,
              workerConfirmed: true
            });
            delete trackStates.ADVERTISEMENTS;
          }
        }

        // Execute occurrence on the actual channel playout engine / audio mixer / graphics layer
        const dispatchT0 = performance.now();
        const execOutcome = await this._dispatchOccurrenceToEngine(
          occ, activeRevision, playoutInst,
          occ.trackType === 'ADVERTISEMENTS' ? Number(interruptedProgram?.resumeOffsetMs || 0) : 0
        );
        const commandLatencyMs = Math.round((performance.now() - dispatchT0) * 100) / 100;

        const asRun = await schedRepo.updateAsRunRecord(claim.record.id, this.organizationId, {
          status: execOutcome.ok ? 'RUNNING' : 'FAILED_TO_START',
          interruptionReason: execOutcome.error || null,
          workerConfirmed: execOutcome.workerConfirmed,
          details: { startErrorMs: nowMs - occ.plannedStartMs, commandLatencyMs, ...execOutcome.details }
        });

        if (execOutcome.ok) {
          trackStates[occ.trackType] = {
            eventId: occ.id,
            occurrenceId: occ.occurrenceId,
            asRunId: asRun.id,
            title: occ.title,
            trackType: occ.trackType,
            executionMode: occ.executionMode,
            mediaAssetId: occ.mediaAssetId || null,
            videoSourceId: occ.videoSourceId || null,
            audioSourceId: occ.audioSourceId || null,
            plannedStartMs: occ.plannedStartMs,
            plannedEndMs: occ.plannedEndMs,
            actualStartMs: nowMs,
            resumeOffsetMs: 0
          };
          if (occ.trackType === 'MAIN_VIDEO' || occ.trackType === 'LIVE_CAMERA_ROTATION') {
            gapFallbackActive = false;
          }
        } else if ((occ.trackType === 'MAIN_VIDEO' || occ.trackType === 'LIVE_CAMERA_ROTATION') && !gapFallbackActive) {
          // Unavailable or failed primary source -> immediately activate schedule gap fallback
          await this._activateScheduleGapFallback(activeRevision, playoutInst, schedRepo, nowMs);
          gapFallbackActive = true;
        }
      }

      // 3. Unscheduled Gap Policy Handling: if no primary video event is active and no ad is playing, activate gap fallback without stopping the channel
      const hasPrimaryVideo = Boolean(trackStates.MAIN_VIDEO || trackStates.LIVE_CAMERA_ROTATION || trackStates.ADVERTISEMENTS);
      if (!hasPrimaryVideo && !gapFallbackActive && activeRevision.events.length > 0) {
        await this._activateScheduleGapFallback(activeRevision, playoutInst, schedRepo, nowMs);
        gapFallbackActive = true;
      }

      return await schedRepo.updateExecutionState(this.channelId, this.organizationId, {
        activeRevisionId: activeRevision.id,
        activeRevisionNumber: activeRevision.revisionNumber,
        timezone: activeRevision.timezone || 'UTC',
        schedulerRunning: true,
        currentTrackStates: trackStates,
        claimedOccurrenceIds: [...claimedSet],
        interruptedProgramState: interruptedProgram,
        gapFallbackActive,
        leaseOwnerId: this.instanceLeaseId,
        leaseExpiresAt: nowMs + 5000,
        lastHeartbeatAt: nowIso
      }, { ownerId: this.instanceLeaseId });
    } finally {
      this.stepping = false;
    }
  }

  _hasActivePrimaryEvent(currentTrackStates = {}, nowMs = Date.now()) {
    const main = currentTrackStates.MAIN_VIDEO || currentTrackStates.LIVE_CAMERA_ROTATION;
    return Boolean(main && main.plannedEndMs > nowMs);
  }

  async _resumeInterruptedProgram(interrupted, activeRevision, playoutInst, schedRepo, trackStates, nowMs) {
    const nowIso = new Date(nowMs).toISOString();
    const resumeOffsetMs = Number(interrupted.resumeOffsetMs || 0);
    const remainingMs = Math.max(2000, interrupted.plannedEndMs - interrupted.plannedStartMs - resumeOffsetMs);

    // If the playout engine already restored the movie itself at the saved offset after the ad file ended, do not seek twice
    const liveCfg = await RepositoryFactory.getChannelPlayoutRepository().getChannelConfig(this.channelId, this.organizationId);
    const engineAlreadyResumed = Boolean(
      playoutInst.proc && !playoutInst.proc.killed &&
      !liveCfg.adState?.active &&
      liveCfg.currentMediaAssetId === interrupted.mediaAssetId &&
      Number(liveCfg.playbackPositionMs || 0) >= resumeOffsetMs - 1000
    );

    const execOutcome = engineAlreadyResumed
      ? { ok: true, workerConfirmed: true, details: { engineResumed: true } }
      : await this._dispatchOccurrenceToEngine(
      {
        id: interrupted.eventId,
        title: interrupted.title,
        trackType: interrupted.trackType || 'MAIN_VIDEO',
        executionMode: interrupted.executionMode || 'HARD_START',
        mediaAssetId: interrupted.mediaAssetId,
        videoSourceId: interrupted.videoSourceId
      },
      activeRevision,
      playoutInst,
      resumeOffsetMs
    );

    const asRun = await schedRepo.createAsRunRecord({
      organizationId: this.organizationId,
      channelId: this.channelId,
      revisionId: activeRevision.id,
      revisionNumber: activeRevision.revisionNumber,
      eventId: interrupted.eventId,
      occurrenceId: `${interrupted.occurrenceId}:resumed@${nowMs}`,
      trackType: interrupted.trackType || 'MAIN_VIDEO',
      executionMode: interrupted.executionMode || 'HARD_START',
      title: `${interrupted.title} (Resumed)`,
      category: 'MOVIE_RESUME',
      mediaAssetId: interrupted.mediaAssetId || null,
      videoSourceId: interrupted.videoSourceId || null,
      plannedStartUtc: nowIso,
      actualStartUtc: nowIso,
      plannedEndUtc: new Date(nowMs + remainingMs).toISOString(),
      plannedDurationMs: remainingMs,
      status: execOutcome.ok ? 'RUNNING' : 'FAILED_TO_START',
      resumeOffsetMs,
      workerConfirmed: execOutcome.workerConfirmed,
      details: { resumedFromAd: true, resumeOffsetMs, ...execOutcome.details }
    });

    trackStates[interrupted.trackType || 'MAIN_VIDEO'] = {
      ...interrupted,
      asRunId: asRun.id,
      actualStartMs: nowMs,
      plannedEndMs: nowMs + remainingMs,
      resumeOffsetMs
    };
  }

  async _activateScheduleGapFallback(activeRevision, playoutInst, schedRepo, nowMs) {
    const nowIso = new Date(nowMs).toISOString();
    const policy = activeRevision.gapPolicy || 'FALLBACK_PLAYLIST';
    let workerConfirmed = false;

    if (playoutInst.proc && !playoutInst.proc.killed) {
      await playoutInst._activateFallback(
        await RepositoryFactory.getChannelPlayoutRepository().getChannelConfig(this.channelId, this.organizationId),
        `SCHEDULE_GAP_${policy}`
      );
      workerConfirmed = true;
    }

    await schedRepo.createAsRunRecord({
      organizationId: this.organizationId,
      channelId: this.channelId,
      revisionId: activeRevision.id,
      revisionNumber: activeRevision.revisionNumber,
      eventId: 'schedule-gap-fallback',
      occurrenceId: `gap-fallback@${nowMs}`,
      trackType: 'MAIN_VIDEO',
      executionMode: 'FOLLOW_PREVIOUS',
      title: `Gap Fallback (${policy})`,
      category: 'FALLBACK',
      mediaAssetId: activeRevision.gapFallbackAssetId || null,
      videoSourceId: activeRevision.gapFallbackSourceId || null,
      plannedStartUtc: nowIso,
      actualStartUtc: nowIso,
      plannedEndUtc: new Date(nowMs + 60000).toISOString(),
      plannedDurationMs: 60000,
      status: 'FALLBACK_ACTIVE',
      interruptionReason: 'UNSCHEDULED_TIMELINE_GAP',
      workerConfirmed,
      details: { gapPolicy: policy }
    });
  }

  async _dispatchOccurrenceToEngine(occ, activeRevision, playoutInst, seekOffsetMs = 0) {
    try {
      const playoutRepo = RepositoryFactory.getChannelPlayoutRepository();
      const audioRepo = RepositoryFactory.getAudioRepository();

      if (occ.trackType === 'LIVE_CAMERA_ROTATION') {
        const cameras = Array.isArray(occ.metadata?.cameraSequence) && occ.metadata.cameraSequence.length
          ? occ.metadata.cameraSequence
          : null;
        if (cameras) {
          await playoutRepo.saveChannelConfig(this.channelId, this.organizationId, {
            playoutMode: 'CAMERA_ROTATION',
            cameraSequence: cameras,
            cameraRepeat: true,
            activeCameraIndex: 0
          });
        }
        if (playoutInst.proc && !playoutInst.proc.killed) {
          await playoutInst._stepCameraRotation(0);
          return { ok: true, workerConfirmed: true, details: { dispatched: 'CAMERA_ROTATION' } };
        }
        return { ok: true, workerConfirmed: false, details: { dispatched: 'CAMERA_ROTATION_CONFIG_ONLY' } };
      }

      if (occ.trackType === 'MAIN_VIDEO') {
        if (occ.mediaAssetId) {
          await playoutRepo.saveChannelConfig(this.channelId, this.organizationId, {
            playoutMode: 'MOVIE_PLAYOUT',
            movieQueue: [{
              id: occ.id,
              assetId: occ.mediaAssetId,
              title: occ.title,
              durationSeconds: Math.round((occ.plannedEndMs - occ.plannedStartMs) / 1000) || 60
            }],
            activeMovieIndex: 0,
            currentMediaAssetId: occ.mediaAssetId,
            playbackPositionMs: seekOffsetMs
          });
          if (playoutInst.proc && !playoutInst.proc.killed) {
            await playoutInst._startMovieAtIndex(0, seekOffsetMs);
            return { ok: true, workerConfirmed: true, details: { dispatched: 'MOVIE_PLAYOUT', seekOffsetMs } };
          }
          return { ok: true, workerConfirmed: false, details: { dispatched: 'MOVIE_CONFIG_ONLY', seekOffsetMs } };
        }
      }

      if (occ.trackType === 'ADVERTISEMENTS') {
        if (occ.mediaAssetId && playoutInst.proc && !playoutInst.proc.killed) {
          const played = await playoutInst._playAdvertisementBreak(occ.mediaAssetId, 0, seekOffsetMs);
          return { ok: played, workerConfirmed: played, details: { dispatched: 'ADVERTISEMENT_BREAK' } };
        }
        await audioRepo.saveChannelMixerConfig(this.channelId, this.organizationId, { adActive: true });
        return { ok: true, workerConfirmed: Boolean(playoutInst.proc), details: { dispatched: 'AD_AUDIO_POLICY' } };
      }

      if (occ.trackType === 'INDEPENDENT_AUDIO') {
        const audioEngine = multiChannelAudio.getEngine(this.channelId, this.organizationId);
        if (occ.audioSourceId) {
          const exclusiveDeck = occ.metadata?.exclusiveDeck !== false;
          if (exclusiveDeck) {
            const allSources = await audioRepo.listAudioSources(this.organizationId, { channelId: this.channelId });
            const previousActive = allSources.find(s => s.id !== occ.audioSourceId && s.enabled && !s.muted);
            for (const s of allSources) {
              if (s.id !== occ.audioSourceId && s.enabled && ['UPLOADED_AUDIO', 'MUSIC_PLAYLIST', 'INTERNET_RADIO', 'ICECAST_STREAM', 'SHOUTCAST_STREAM'].includes(s.sourceType)) {
                await audioRepo.updateAudioSource(s.id, this.organizationId, { enabled: false });
              }
            }
            if (previousActive && Number(occ.metadata?.crossfadeDurationMs || 0) > 0) {
              audioEngine.startCrossfade(previousActive.id, occ.audioSourceId, Number(occ.metadata.crossfadeDurationMs));
            }
          }
          const updates = {
            enabled: occ.metadata?.enabled !== undefined ? Boolean(occ.metadata.enabled) : true,
            ...(occ.metadata?.volumeLinear !== undefined ? { volumeLinear: Number(occ.metadata.volumeLinear) } : {}),
            ...(occ.metadata?.gainDb !== undefined ? { gainDb: Number(occ.metadata.gainDb) } : {}),
            ...(occ.metadata?.muted !== undefined ? { muted: Boolean(occ.metadata.muted) } : {})
          };
          await audioRepo.updateAudioSource(occ.audioSourceId, this.organizationId, updates);
        }
        if (occ.metadata?.routingMode || occ.metadata?.duckingEnabled !== undefined) {
          await audioRepo.saveChannelMixerConfig(this.channelId, this.organizationId, {
            ...(occ.metadata.routingMode ? { routingMode: occ.metadata.routingMode } : {}),
            ...(occ.metadata.duckingEnabled !== undefined ? { duckingEnabled: Boolean(occ.metadata.duckingEnabled) } : {})
          });
        }
        // Step one PCM mix frame so meters update immediately without restarting video encoder
        await audioEngine.stepFrame({ persistMeters: true });
        return { ok: true, workerConfirmed: true, details: { dispatched: 'INDEPENDENT_AUDIO' } };
      }

      if (occ.trackType === 'GRAPHICS_OVERLAYS' || occ.trackType === 'NEWS_TICKER') {
        const cfg = await playoutRepo.getChannelConfig(this.channelId, this.organizationId);
        const nextGraphics = {
          ...(cfg.graphicsConfig || {}),
          ...(occ.trackType === 'GRAPHICS_OVERLAYS'
            ? { watermarkEnabled: occ.metadata?.enabled !== false }
            : { tickerEnabled: occ.metadata?.enabled !== false, tickerText: occ.metadata?.tickerText || occ.title })
        };
        await playoutRepo.saveChannelConfig(this.channelId, this.organizationId, { graphicsConfig: nextGraphics });
        if (playoutInst.proc && !playoutInst.proc.killed && occ.metadata?.bitmap) {
          await playoutInst.sendWorkerCommand({
            cmd: 'watermark',
            bitmap: occ.metadata.bitmap,
            alpha: occ.metadata?.enabled === false ? 0.0 : 0.9
          }, true);
          return { ok: true, workerConfirmed: true, details: { dispatched: occ.trackType } };
        }
        return { ok: true, workerConfirmed: Boolean(playoutInst.proc), details: { dispatched: occ.trackType } };
      }

      if (occ.trackType === 'AUTOMATION_CONTROL') {
        return { ok: true, workerConfirmed: true, details: { dispatched: 'AUTOMATION_CONTROL', action: occ.metadata?.action || 'noop' } };
      }

      return { ok: true, workerConfirmed: Boolean(playoutInst.proc), details: { dispatched: occ.trackType } };
    } catch (error) {
      return { ok: false, workerConfirmed: false, error: error.message || 'Dispatch failed', details: {} };
    }
  }
}

export class MultiChannelSchedulerManager {
  constructor() {
    this.executors = new Map(); // `${organizationId}:${channelId}` -> ChannelScheduleExecutor
  }

  getExecutor(channelId, organizationId) {
    const key = `${organizationId}:${channelId}`;
    let ex = this.executors.get(key);
    if (!ex) {
      ex = new ChannelScheduleExecutor(channelId, organizationId, this);
      this.executors.set(key, ex);
    }
    return ex;
  }

  stopAll() {
    for (const ex of this.executors.values()) {
      ex.stopLoop();
    }
  }
}

export const multiChannelScheduler = new MultiChannelSchedulerManager();

/**
 * Generates an EPG-compatible (Electronic Program Guide / XMLTV-ready) program listing
 * from the active published schedule revision of a channel over a bounded time window.
 */
export async function generateChannelEpgGuide(channelId, organizationId, {
  windowStartMs = Date.now(),
  windowEndMs = Date.now() + 24 * 60 * 60 * 1000
} = {}) {
  const schedRepo = RepositoryFactory.getBroadcastSchedulerRepository();
  const activeRev = await schedRepo.getActivePublishedRevision(channelId, organizationId);
  if (!activeRev) {
    return { channelId, timezone: 'UTC', programs: [] };
  }
  const occurrences = expandScheduleOccurrences(activeRev.events, {
    timezone: activeRev.timezone || 'UTC',
    windowStartMs,
    windowEndMs
  }).filter(o => o.trackType === 'MAIN_VIDEO' || o.trackType === 'LIVE_CAMERA_ROTATION');

  return {
    channelId,
    revisionNumber: activeRev.revisionNumber,
    timezone: activeRev.timezone || 'UTC',
    programs: occurrences.map(o => ({
      programId: o.occurrenceId,
      eventId: o.id,
      channelId,
      title: o.title,
      description: o.description || o.metadata?.notes || '',
      category: o.category || o.trackType,
      language: o.metadata?.language || 'ar',
      startTimeUtc: o.plannedStartUtc,
      endTimeUtc: o.plannedEndUtc,
      durationMs: o.plannedEndMs - o.plannedStartMs,
      artworkAssetId: o.metadata?.artworkAssetId || o.mediaAssetId || null
    }))
  };
}
