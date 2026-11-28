import { randomUUID } from 'node:crypto';
import { IBroadcastSchedulerRepository } from '@mcr/domain';
import { SCHEDULE_LIFECYCLE_STATES } from '@mcr/shared';
import { getSqliteDatabase } from '../database/sqlite.js';
import { insertAuditEvent } from './sqlite-audit-repository.js';

function parseJson(raw, fallback) {
  try {
    if (raw === null || raw === undefined || raw === '') return fallback;
    if (typeof raw === 'object') return raw;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function mapScheduleRevisionRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    organizationId: row.organizationId,
    channelId: row.channelId,
    revisionNumber: Number(row.revisionNumber),
    name: row.name || 'Broadcast Schedule',
    timezone: row.timezone || 'UTC',
    lifecycleState: row.lifecycleState || SCHEDULE_LIFECYCLE_STATES.DRAFT,
    activationPolicy: row.activationPolicy || 'APPLY_NEXT_BOUNDARY',
    effectiveFromUtc: row.effectiveFromUtc ? new Date(row.effectiveFromUtc).toISOString() : null,
    gapPolicy: row.gapPolicy || 'FALLBACK_PLAYLIST',
    gapFallbackAssetId: row.gapFallbackAssetId || null,
    gapFallbackSourceId: row.gapFallbackSourceId || null,
    gapFallbackPlaylistId: row.gapFallbackPlaylistId || null,
    events: parseJson(row.events, []),
    templates: parseJson(row.templates, []),
    validationSummary: parseJson(row.validationSummary, {}),
    publishedByUserId: row.publishedByUserId || null,
    publishedAt: row.publishedAt ? new Date(row.publishedAt).toISOString() : null,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt)
  };
}

export function defaultSchedulerExecutionState(channelId, organizationId) {
  const nowIso = new Date().toISOString();
  return {
    channelId,
    organizationId,
    activeRevisionId: null,
    activeRevisionNumber: 0,
    pendingRevisionId: null,
    pendingActivationPolicy: null,
    pendingEffectiveAtUtc: null,
    timezone: 'UTC',
    schedulerRunning: false,
    holdActive: false,
    emergencyOverrideActive: false,
    manualOverrideActive: false,
    overrideSourceId: null,
    overrideExpiresAtUtc: null,
    currentTrackStates: {},
    claimedOccurrenceIds: [],
    interruptedProgramState: {},
    gapFallbackActive: false,
    leaseOwnerId: null,
    leaseExpiresAt: 0,
    lastHeartbeatAt: null,
    lastReconciledAt: null,
    updatedAt: nowIso
  };
}

export function mapSchedulerExecutionStateRow(row) {
  if (!row) return null;
  return {
    channelId: row.channelId,
    organizationId: row.organizationId,
    activeRevisionId: row.activeRevisionId || null,
    activeRevisionNumber: Number(row.activeRevisionNumber ?? 0),
    pendingRevisionId: row.pendingRevisionId || null,
    pendingActivationPolicy: row.pendingActivationPolicy || null,
    pendingEffectiveAtUtc: row.pendingEffectiveAtUtc ? new Date(row.pendingEffectiveAtUtc).toISOString() : null,
    timezone: row.timezone || 'UTC',
    schedulerRunning: Boolean(row.schedulerRunning),
    holdActive: Boolean(row.holdActive),
    emergencyOverrideActive: Boolean(row.emergencyOverrideActive),
    manualOverrideActive: Boolean(row.manualOverrideActive),
    overrideSourceId: row.overrideSourceId || null,
    overrideExpiresAtUtc: row.overrideExpiresAtUtc ? new Date(row.overrideExpiresAtUtc).toISOString() : null,
    currentTrackStates: parseJson(row.currentTrackStates, {}),
    claimedOccurrenceIds: parseJson(row.claimedOccurrenceIds, []),
    interruptedProgramState: parseJson(row.interruptedProgramState, {}),
    gapFallbackActive: Boolean(row.gapFallbackActive),
    leaseOwnerId: row.leaseOwnerId || null,
    leaseExpiresAt: Number(row.leaseExpiresAt ?? 0),
    lastHeartbeatAt: row.lastHeartbeatAt ? new Date(row.lastHeartbeatAt).toISOString() : null,
    lastReconciledAt: row.lastReconciledAt ? new Date(row.lastReconciledAt).toISOString() : null,
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt)
  };
}

export function mapAsRunLogRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    organizationId: row.organizationId,
    channelId: row.channelId,
    revisionId: row.revisionId || null,
    revisionNumber: Number(row.revisionNumber ?? 0),
    eventId: row.eventId,
    occurrenceId: row.occurrenceId,
    trackType: row.trackType,
    executionMode: row.executionMode,
    title: row.title,
    category: row.category || 'PROGRAM',
    mediaAssetId: row.mediaAssetId || null,
    videoSourceId: row.videoSourceId || null,
    audioSourceId: row.audioSourceId || null,
    plannedStartUtc: row.plannedStartUtc instanceof Date ? row.plannedStartUtc.toISOString() : String(row.plannedStartUtc),
    actualStartUtc: row.actualStartUtc instanceof Date ? row.actualStartUtc.toISOString() : String(row.actualStartUtc),
    plannedEndUtc: row.plannedEndUtc instanceof Date ? row.plannedEndUtc.toISOString() : String(row.plannedEndUtc),
    actualEndUtc: row.actualEndUtc ? (row.actualEndUtc instanceof Date ? row.actualEndUtc.toISOString() : String(row.actualEndUtc)) : null,
    plannedDurationMs: Number(row.plannedDurationMs),
    actualDurationMs: row.actualDurationMs != null ? Number(row.actualDurationMs) : null,
    status: row.status || 'RUNNING',
    interruptionReason: row.interruptionReason || null,
    resumeOffsetMs: Number(row.resumeOffsetMs ?? 0),
    workerConfirmed: Boolean(row.workerConfirmed),
    details: parseJson(row.details, {}),
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt)
  };
}

export class SqliteBroadcastSchedulerRepository extends IBroadcastSchedulerRepository {
  get db() {
    return getSqliteDatabase();
  }

  async getOrCreateDraftRevision(channelId, organizationId, actor) {
    const db = this.db;
    const existingDraft = db.prepare(`
      SELECT * FROM channel_schedule_revisions
      WHERE organizationId = ? AND channelId = ? AND lifecycleState IN ('DRAFT', 'VALIDATED')
      ORDER BY revisionNumber DESC LIMIT 1
    `).get(organizationId, channelId);

    if (existingDraft) return mapScheduleRevisionRow(existingDraft);

    const activePub = db.prepare(`
      SELECT * FROM channel_schedule_revisions
      WHERE organizationId = ? AND channelId = ? AND lifecycleState = 'PUBLISHED'
      ORDER BY revisionNumber DESC LIMIT 1
    `).get(organizationId, channelId);

    const maxRevRow = db.prepare(`
      SELECT COALESCE(MAX(revisionNumber), 0) AS maxRev FROM channel_schedule_revisions
      WHERE organizationId = ? AND channelId = ?
    `).get(organizationId, channelId);
    const nextRev = Number(maxRevRow?.maxRev ?? 0) + 1;
    const id = randomUUID();
    const nowIso = new Date().toISOString();

    db.prepare(`
      INSERT INTO channel_schedule_revisions (
        id, organizationId, channelId, revisionNumber, name, timezone, lifecycleState,
        activationPolicy, effectiveFromUtc, gapPolicy, gapFallbackAssetId, gapFallbackSourceId, gapFallbackPlaylistId,
        events, templates, validationSummary, publishedByUserId, publishedAt, createdByUserId, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, 'DRAFT', ?, NULL, ?, ?, ?, ?, ?, ?, '{}', NULL, NULL, ?, ?, ?)
    `).run(
      id,
      organizationId,
      channelId,
      nextRev,
      activePub?.name || 'Broadcast Schedule',
      activePub?.timezone || 'UTC',
      activePub?.activationPolicy || 'APPLY_NEXT_BOUNDARY',
      activePub?.gapPolicy || 'FALLBACK_PLAYLIST',
      activePub?.gapFallbackAssetId || null,
      activePub?.gapFallbackSourceId || null,
      activePub?.gapFallbackPlaylistId || null,
      activePub?.events || '[]',
      activePub?.templates || '[]',
      actor?.id || 'system',
      nowIso,
      nowIso
    );

    return await this.getRevisionById(id, organizationId);
  }

  async saveDraftRevision(channelId, organizationId, draftPayload, actor) {
    const db = this.db;
    const currentDraft = await this.getOrCreateDraftRevision(channelId, organizationId, actor);

    if (
      draftPayload.expectedRevisionNumber !== undefined &&
      Number(draftPayload.expectedRevisionNumber) !== currentDraft.revisionNumber
    ) {
      throw Object.assign(
        new Error('Schedule draft revision mismatch; another operator updated or published this draft'),
        { statusCode: 409 }
      );
    }

    const nowIso = new Date().toISOString();
    const nextName = draftPayload.name ?? currentDraft.name;
    const nextTz = draftPayload.timezone ?? currentDraft.timezone;
    const nextPolicy = draftPayload.activationPolicy ?? currentDraft.activationPolicy;
    const nextEff = draftPayload.effectiveFromUtc !== undefined ? draftPayload.effectiveFromUtc : currentDraft.effectiveFromUtc;
    const nextGapPolicy = draftPayload.gapPolicy ?? currentDraft.gapPolicy;
    const nextGapAsset = draftPayload.gapFallbackAssetId !== undefined ? draftPayload.gapFallbackAssetId : currentDraft.gapFallbackAssetId;
    const nextGapSource = draftPayload.gapFallbackSourceId !== undefined ? draftPayload.gapFallbackSourceId : currentDraft.gapFallbackSourceId;
    const nextGapPlaylist = draftPayload.gapFallbackPlaylistId !== undefined ? draftPayload.gapFallbackPlaylistId : currentDraft.gapFallbackPlaylistId;
    const nextEvents = draftPayload.events !== undefined ? draftPayload.events : currentDraft.events;
    const nextTemplates = draftPayload.templates !== undefined ? draftPayload.templates : currentDraft.templates;

    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(`
        UPDATE channel_schedule_revisions SET
          name = ?, timezone = ?, lifecycleState = 'DRAFT',
          activationPolicy = ?, effectiveFromUtc = ?,
          gapPolicy = ?, gapFallbackAssetId = ?, gapFallbackSourceId = ?, gapFallbackPlaylistId = ?,
          events = ?, templates = ?, validationSummary = '{}', updatedAt = ?
        WHERE id = ? AND organizationId = ?
      `).run(
        nextName,
        nextTz,
        nextPolicy,
        nextEff || null,
        nextGapPolicy,
        nextGapAsset || null,
        nextGapSource || null,
        nextGapPlaylist || null,
        JSON.stringify(nextEvents),
        JSON.stringify(nextTemplates),
        nowIso,
        currentDraft.id,
        organizationId
      );

      if (actor) {
        insertAuditEvent(db, {
          organizationId,
          userId: actor.id,
          action: 'SCHEDULE_DRAFT_SAVED',
          resourceType: 'ChannelScheduleRevision',
          resourceId: currentDraft.id,
          details: { channelId, revisionNumber: currentDraft.revisionNumber, eventCount: nextEvents.length },
          ipAddress: actor.ipAddress
        });
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }

    return await this.getRevisionById(currentDraft.id, organizationId);
  }

  async markRevisionValidated(revisionId, organizationId, validationSummary, actor) {
    const db = this.db;
    const existing = await this.getRevisionById(revisionId, organizationId);
    if (!existing) return null;
    if (!['DRAFT', 'VALIDATED'].includes(existing.lifecycleState)) {
      throw Object.assign(new Error('Only DRAFT or VALIDATED revisions can be validated'), { statusCode: 409 });
    }
    const nowIso = new Date().toISOString();
    const nextState = validationSummary.valid ? SCHEDULE_LIFECYCLE_STATES.VALIDATED : SCHEDULE_LIFECYCLE_STATES.DRAFT;
    db.prepare(`
      UPDATE channel_schedule_revisions
      SET lifecycleState = ?, validationSummary = ?, updatedAt = ?
      WHERE id = ? AND organizationId = ?
    `).run(nextState, JSON.stringify(validationSummary), nowIso, revisionId, organizationId);
    return await this.getRevisionById(revisionId, organizationId);
  }

  async publishRevision(channelId, organizationId, {
    revisionId,
    expectedRevisionNumber,
    activationPolicy,
    effectiveFromUtc = null,
    validationSummary
  }, actor) {
    const db = this.db;
    const target = revisionId
      ? await this.getRevisionById(revisionId, organizationId)
      : await this.getOrCreateDraftRevision(channelId, organizationId, actor);

    if (!target || target.channelId !== channelId) {
      throw Object.assign(new Error('Schedule revision not found for channel'), { statusCode: 404 });
    }
    if (expectedRevisionNumber !== undefined && Number(expectedRevisionNumber) !== target.revisionNumber) {
      throw Object.assign(new Error('Schedule revision number mismatch during publication'), { statusCode: 409 });
    }
    if (!['DRAFT', 'VALIDATED'].includes(target.lifecycleState)) {
      throw Object.assign(new Error(`Revision ${target.revisionNumber} is already ${target.lifecycleState} and is immutable`), {
        statusCode: 409
      });
    }

    const nowIso = new Date().toISOString();
    const finalPolicy = activationPolicy || target.activationPolicy || 'APPLY_NEXT_BOUNDARY';
    const finalEffective = effectiveFromUtc !== undefined ? effectiveFromUtc : target.effectiveFromUtc;

    db.exec('BEGIN IMMEDIATE');
    try {
      // Mark any prior PUBLISHED revisions as SUPERSEDED (unless we are staging a future-effective revision)
      const isFutureActivation = finalPolicy === 'APPLY_FUTURE_TIME' && finalEffective && Date.parse(finalEffective) > Date.now();
      if (!isFutureActivation) {
        db.prepare(`
          UPDATE channel_schedule_revisions
          SET lifecycleState = 'SUPERSEDED', updatedAt = ?
          WHERE organizationId = ? AND channelId = ? AND lifecycleState = 'PUBLISHED' AND id != ?
        `).run(nowIso, organizationId, channelId, target.id);
      }

      db.prepare(`
        UPDATE channel_schedule_revisions
        SET lifecycleState = 'PUBLISHED',
            activationPolicy = ?,
            effectiveFromUtc = ?,
            validationSummary = ?,
            publishedByUserId = ?,
            publishedAt = ?,
            updatedAt = ?
        WHERE id = ? AND organizationId = ?
      `).run(
        finalPolicy,
        finalEffective || null,
        JSON.stringify(validationSummary || target.validationSummary || { valid: true }),
        actor?.id || 'system',
        nowIso,
        nowIso,
        target.id,
        organizationId
      );

      if (actor) {
        insertAuditEvent(db, {
          organizationId,
          userId: actor.id,
          action: 'SCHEDULE_REVISION_PUBLISHED',
          resourceType: 'ChannelScheduleRevision',
          resourceId: target.id,
          details: {
            channelId,
            revisionNumber: target.revisionNumber,
            activationPolicy: finalPolicy,
            effectiveFromUtc: finalEffective
          },
          ipAddress: actor.ipAddress
        });
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }

    return await this.getRevisionById(target.id, organizationId);
  }

  async getActivePublishedRevision(channelId, organizationId) {
    const row = this.db.prepare(`
      SELECT * FROM channel_schedule_revisions
      WHERE organizationId = ? AND channelId = ? AND lifecycleState = 'PUBLISHED'
      ORDER BY revisionNumber DESC LIMIT 1
    `).get(organizationId, channelId);
    return mapScheduleRevisionRow(row);
  }

  async getRevisionById(revisionId, organizationId) {
    const row = this.db.prepare(`
      SELECT * FROM channel_schedule_revisions WHERE id = ? AND organizationId = ?
    `).get(revisionId, organizationId);
    return mapScheduleRevisionRow(row);
  }

  async listRevisions(channelId, organizationId) {
    const rows = this.db.prepare(`
      SELECT * FROM channel_schedule_revisions
      WHERE organizationId = ? AND channelId = ?
      ORDER BY revisionNumber DESC LIMIT 50
    `).all(organizationId, channelId);
    return rows.map(mapScheduleRevisionRow);
  }

  async getExecutionState(channelId, organizationId) {
    const row = this.db.prepare(`
      SELECT * FROM channel_scheduler_execution_states
      WHERE channelId = ? AND organizationId = ?
    `).get(channelId, organizationId);
    if (row) return mapSchedulerExecutionStateRow(row);
    return defaultSchedulerExecutionState(channelId, organizationId);
  }

  /**
   * Atomic compare-and-set lease acquisition. A scheduler instance may hold the lease when it already owns it,
   * when nobody owns it, or when the previous lease expired (relative to the caller's clock `nowMs`).
   */
  async acquireSchedulerLease(channelId, organizationId, ownerId, nowMs, ttlMs = 5000) {
    const db = this.db;
    db.exec('BEGIN IMMEDIATE');
    try {
      const row = db.prepare(`
        SELECT leaseOwnerId, leaseExpiresAt FROM channel_scheduler_execution_states
        WHERE channelId = ? AND organizationId = ?
      `).get(channelId, organizationId);
      let acquired = false;
      let tookOverFrom = null;
      if (!row) {
        const nowIso = new Date().toISOString();
        db.prepare(`
          INSERT INTO channel_scheduler_execution_states (channelId, organizationId, leaseOwnerId, leaseExpiresAt, updatedAt)
          VALUES (?, ?, ?, ?, ?)
        `).run(channelId, organizationId, ownerId, nowMs + ttlMs, nowIso);
        acquired = true;
      } else if (!row.leaseOwnerId || row.leaseOwnerId === ownerId || Number(row.leaseExpiresAt) <= nowMs) {
        if (row.leaseOwnerId && row.leaseOwnerId !== ownerId) tookOverFrom = row.leaseOwnerId;
        db.prepare(`
          UPDATE channel_scheduler_execution_states SET leaseOwnerId = ?, leaseExpiresAt = ?, updatedAt = ?
          WHERE channelId = ? AND organizationId = ?
        `).run(ownerId, nowMs + ttlMs, new Date().toISOString(), channelId, organizationId);
        acquired = true;
      }
      db.exec('COMMIT');
      return { acquired, tookOverFrom };
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  async releaseSchedulerLease(channelId, organizationId, ownerId) {
    this.db.prepare(`
      UPDATE channel_scheduler_execution_states SET leaseOwnerId = NULL, leaseExpiresAt = 0
      WHERE channelId = ? AND organizationId = ? AND leaseOwnerId = ?
    `).run(channelId, organizationId, ownerId);
  }

  /**
   * Durable write-ahead claim: inserts the As-Run row (status CLAIMED) only if the occurrence has never been claimed
   * and the caller still owns the channel lease. Returns { claimed, ownerLost }.
   */
  async claimOccurrence(record, { ownerId = null } = {}) {
    const db = this.db;
    db.exec('BEGIN IMMEDIATE');
    try {
      if (ownerId) {
        const row = db.prepare(`
          SELECT leaseOwnerId FROM channel_scheduler_execution_states WHERE channelId = ? AND organizationId = ?
        `).get(record.channelId, record.organizationId);
        if (!row || row.leaseOwnerId !== ownerId) {
          db.exec('ROLLBACK');
          return { claimed: false, ownerLost: true, record: null };
        }
      }
      const id = record.id || randomUUID();
      const nowIso = new Date().toISOString();
      const result = db.prepare(`
        INSERT INTO channel_as_run_logs (
          id, organizationId, channelId, revisionId, revisionNumber,
          eventId, occurrenceId, trackType, executionMode, title, category,
          mediaAssetId, videoSourceId, audioSourceId,
          plannedStartUtc, actualStartUtc, plannedEndUtc, actualEndUtc,
          plannedDurationMs, actualDurationMs, status, interruptionReason,
          resumeOffsetMs, workerConfirmed, details, createdAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(occurrenceId) DO NOTHING
      `).run(
        id, record.organizationId, record.channelId, record.revisionId || null, record.revisionNumber ?? 0,
        record.eventId, record.occurrenceId, record.trackType, record.executionMode, record.title,
        record.category || 'PROGRAM',
        record.mediaAssetId || null, record.videoSourceId || null, record.audioSourceId || null,
        record.plannedStartUtc, record.actualStartUtc || nowIso, record.plannedEndUtc, null,
        record.plannedDurationMs, null, 'CLAIMED', null,
        record.resumeOffsetMs ?? 0, 0, JSON.stringify(record.details || {}), nowIso
      );
      db.exec('COMMIT');
      const claimed = Number(result.changes) === 1;
      const row = db.prepare('SELECT * FROM channel_as_run_logs WHERE occurrenceId = ?').get(record.occurrenceId);
      return { claimed, ownerLost: false, record: mapAsRunLogRow(row) };
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch {}
      throw error;
    }
  }

  async updateExecutionState(channelId, organizationId, updates, { ownerId = null } = {}) {
    if (ownerId) {
      const row = this.db.prepare(`
        SELECT leaseOwnerId FROM channel_scheduler_execution_states WHERE channelId = ? AND organizationId = ?
      `).get(channelId, organizationId);
      if (!row || row.leaseOwnerId !== ownerId) {
        throw Object.assign(new Error('Scheduler lease is owned by another instance (stale scheduler fenced)'), {
          statusCode: 409,
          code: 'STALE_SCHEDULER_OWNER'
        });
      }
    }
    const current = await this.getExecutionState(channelId, organizationId);
    const nowIso = new Date().toISOString();
    const merged = {
      ...current,
      ...updates,
      channelId,
      organizationId,
      updatedAt: nowIso
    };

    this.db.prepare(`
      INSERT INTO channel_scheduler_execution_states (
        channelId, organizationId, activeRevisionId, activeRevisionNumber,
        pendingRevisionId, pendingActivationPolicy, pendingEffectiveAtUtc,
        timezone, schedulerRunning, holdActive,
        emergencyOverrideActive, manualOverrideActive, overrideSourceId, overrideExpiresAtUtc,
        currentTrackStates, claimedOccurrenceIds, interruptedProgramState,
        gapFallbackActive, leaseOwnerId, leaseExpiresAt,
        lastHeartbeatAt, lastReconciledAt, updatedAt
      ) VALUES (
        ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?
      ) ON CONFLICT(channelId, organizationId) DO UPDATE SET
        activeRevisionId = excluded.activeRevisionId,
        activeRevisionNumber = excluded.activeRevisionNumber,
        pendingRevisionId = excluded.pendingRevisionId,
        pendingActivationPolicy = excluded.pendingActivationPolicy,
        pendingEffectiveAtUtc = excluded.pendingEffectiveAtUtc,
        timezone = excluded.timezone,
        schedulerRunning = excluded.schedulerRunning,
        holdActive = excluded.holdActive,
        emergencyOverrideActive = excluded.emergencyOverrideActive,
        manualOverrideActive = excluded.manualOverrideActive,
        overrideSourceId = excluded.overrideSourceId,
        overrideExpiresAtUtc = excluded.overrideExpiresAtUtc,
        currentTrackStates = excluded.currentTrackStates,
        claimedOccurrenceIds = excluded.claimedOccurrenceIds,
        interruptedProgramState = excluded.interruptedProgramState,
        gapFallbackActive = excluded.gapFallbackActive,
        leaseOwnerId = excluded.leaseOwnerId,
        leaseExpiresAt = excluded.leaseExpiresAt,
        lastHeartbeatAt = excluded.lastHeartbeatAt,
        lastReconciledAt = excluded.lastReconciledAt,
        updatedAt = excluded.updatedAt
    `).run(
      channelId,
      organizationId,
      merged.activeRevisionId || null,
      merged.activeRevisionNumber || 0,
      merged.pendingRevisionId || null,
      merged.pendingActivationPolicy || null,
      merged.pendingEffectiveAtUtc || null,
      merged.timezone || 'UTC',
      merged.schedulerRunning ? 1 : 0,
      merged.holdActive ? 1 : 0,
      merged.emergencyOverrideActive ? 1 : 0,
      merged.manualOverrideActive ? 1 : 0,
      merged.overrideSourceId || null,
      merged.overrideExpiresAtUtc || null,
      JSON.stringify(merged.currentTrackStates || {}),
      JSON.stringify((merged.claimedOccurrenceIds || []).slice(-500)),
      JSON.stringify(merged.interruptedProgramState || {}),
      merged.gapFallbackActive ? 1 : 0,
      merged.leaseOwnerId || null,
      merged.leaseExpiresAt || 0,
      merged.lastHeartbeatAt || null,
      merged.lastReconciledAt || null,
      merged.updatedAt
    );

    return await this.getExecutionState(channelId, organizationId);
  }

  async createAsRunRecord(record) {
    const db = this.db;
    const id = record.id || randomUUID();
    const nowIso = new Date().toISOString();
    db.prepare(`
      INSERT INTO channel_as_run_logs (
        id, organizationId, channelId, revisionId, revisionNumber,
        eventId, occurrenceId, trackType, executionMode, title, category,
        mediaAssetId, videoSourceId, audioSourceId,
        plannedStartUtc, actualStartUtc, plannedEndUtc, actualEndUtc,
        plannedDurationMs, actualDurationMs, status, interruptionReason,
        resumeOffsetMs, workerConfirmed, details, createdAt
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?
      ) ON CONFLICT(occurrenceId) DO UPDATE SET
        status = excluded.status,
        actualEndUtc = COALESCE(excluded.actualEndUtc, channel_as_run_logs.actualEndUtc),
        actualDurationMs = COALESCE(excluded.actualDurationMs, channel_as_run_logs.actualDurationMs),
        interruptionReason = COALESCE(excluded.interruptionReason, channel_as_run_logs.interruptionReason),
        workerConfirmed = excluded.workerConfirmed,
        details = excluded.details
    `).run(
      id,
      record.organizationId,
      record.channelId,
      record.revisionId || null,
      record.revisionNumber ?? 0,
      record.eventId,
      record.occurrenceId,
      record.trackType,
      record.executionMode,
      record.title,
      record.category || 'PROGRAM',
      record.mediaAssetId || null,
      record.videoSourceId || null,
      record.audioSourceId || null,
      record.plannedStartUtc,
      record.actualStartUtc || nowIso,
      record.plannedEndUtc,
      record.actualEndUtc || null,
      record.plannedDurationMs,
      record.actualDurationMs ?? null,
      record.status || 'RUNNING',
      record.interruptionReason || null,
      record.resumeOffsetMs ?? 0,
      record.workerConfirmed ? 1 : 0,
      JSON.stringify(record.details || {}),
      record.createdAt || nowIso
    );
    const row = db.prepare('SELECT * FROM channel_as_run_logs WHERE occurrenceId = ?').get(record.occurrenceId);
    return mapAsRunLogRow(row);
  }

  async updateAsRunRecord(id, organizationId, updates) {
    const db = this.db;
    const existing = db.prepare('SELECT * FROM channel_as_run_logs WHERE id = ? AND organizationId = ?').get(id, organizationId);
    if (!existing) return null;
    const mapped = mapAsRunLogRow(existing);
    const actualEndUtc = updates.actualEndUtc !== undefined ? updates.actualEndUtc : mapped.actualEndUtc;
    const actualDurationMs = updates.actualDurationMs !== undefined
      ? updates.actualDurationMs
      : (actualEndUtc ? Math.max(0, Date.parse(actualEndUtc) - Date.parse(mapped.actualStartUtc)) : mapped.actualDurationMs);

    db.prepare(`
      UPDATE channel_as_run_logs SET
        actualEndUtc = ?,
        actualDurationMs = ?,
        status = ?,
        interruptionReason = ?,
        workerConfirmed = ?,
        details = ?
      WHERE id = ? AND organizationId = ?
    `).run(
      actualEndUtc || null,
      actualDurationMs ?? null,
      updates.status ?? mapped.status,
      updates.interruptionReason !== undefined ? updates.interruptionReason : mapped.interruptionReason,
      (updates.workerConfirmed !== undefined ? updates.workerConfirmed : mapped.workerConfirmed) ? 1 : 0,
      JSON.stringify(updates.details !== undefined ? { ...mapped.details, ...updates.details } : mapped.details),
      id,
      organizationId
    );
    const row = db.prepare('SELECT * FROM channel_as_run_logs WHERE id = ? AND organizationId = ?').get(id, organizationId);
    return mapAsRunLogRow(row);
  }

  async listAsRunRecords(channelId, organizationId, { trackType = '', status = '', limit = 100 } = {}) {
    const clauses = ['organizationId = ?', 'channelId = ?'];
    const params = [organizationId, channelId];
    if (trackType) {
      clauses.push('trackType = ?');
      params.push(trackType);
    }
    if (status) {
      clauses.push('status = ?');
      params.push(status);
    }
    const safeLimit = Math.min(500, Math.max(1, Number(limit) || 100));
    const rows = this.db.prepare(`
      SELECT * FROM channel_as_run_logs
      WHERE ${clauses.join(' AND ')}
      ORDER BY actualStartUtc DESC, createdAt DESC
      LIMIT ?
    `).all(...params, safeLimit);
    return rows.map(mapAsRunLogRow);
  }
}
