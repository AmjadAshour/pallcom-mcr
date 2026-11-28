import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { getPrismaClient } from '../src/infrastructure/database/mysql-prisma.js';

export async function rehearseSqliteToMysqlMigration({
  sqlitePath,
  mysqlUrl
}) {
  assert(sqlitePath, 'Provide sqlitePath for migration rehearsal');
  assert(mysqlUrl, 'Provide mysqlUrl for migration rehearsal');

  const sqlite = new DatabaseSync(sqlitePath, { readOnly: true });
  const prisma = getPrismaClient(mysqlUrl);

  try {
    const tables = new Set(
      sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(r => r.name)
    );
    const readTable = name => (tables.has(name) ? sqlite.prepare(`SELECT * FROM ${name}`).all() : []);

    const orgRows = readTable('organizations');
    const userRows = readTable('users');
    const studioRows = readTable('studios');
    const stationRows = readTable('stations');
    const mediaAssets = readTable('media_assets');
    const uploadSessions = readTable('media_upload_sessions');
    const mediaPlaylists = readTable('media_playlists');
    const videoSources = readTable('video_sources');
    const audioSources = readTable('audio_sources');
    const audioMixerConfigs = readTable('audio_mixer_configs');
    const channelPlayoutConfigs = readTable('channel_playout_configs');
    const channelScheduleRevisions = readTable('channel_schedule_revisions');
    const channelSchedulerExecutionStates = readTable('channel_scheduler_execution_states');
    const channelAsRunLogs = readTable('channel_as_run_logs');
    const auditLogs = readTable('audit_logs');

    // Collect all referenced organization IDs so foreign keys on Organization succeed
    const allOrgIds = new Set(['default-org']);
    for (const r of orgRows) if (r.id) allOrgIds.add(r.id);
    for (const r of userRows) if (r.organizationId) allOrgIds.add(r.organizationId);
    for (const r of studioRows) if (r.organizationId) allOrgIds.add(r.organizationId);
    for (const r of stationRows) if (r.organizationId) allOrgIds.add(r.organizationId);
    for (const r of mediaAssets) if (r.organizationId) allOrgIds.add(r.organizationId);
    for (const r of videoSources) if (r.organizationId) allOrgIds.add(r.organizationId);
    for (const r of audioSources) if (r.organizationId) allOrgIds.add(r.organizationId);
    for (const r of audioMixerConfigs) if (r.organizationId) allOrgIds.add(r.organizationId);
    for (const r of channelPlayoutConfigs) if (r.organizationId) allOrgIds.add(r.organizationId);
    for (const r of channelScheduleRevisions) if (r.organizationId) allOrgIds.add(r.organizationId);
    for (const r of channelSchedulerExecutionStates) if (r.organizationId) allOrgIds.add(r.organizationId);
    for (const r of channelAsRunLogs) if (r.organizationId) allOrgIds.add(r.organizationId);
    for (const r of auditLogs) if (r.organizationId) allOrgIds.add(r.organizationId);

    await prisma.$transaction(async tx => {
      for (const orgId of allOrgIds) {
        const existingOrg = orgRows.find(o => o.id === orgId);
        await tx.organization.upsert({
          where: { id: orgId },
          update: {},
          create: {
            id: orgId,
            name: existingOrg?.name || orgId,
            slug: existingOrg?.slug || (orgId.toLowerCase().replace(/[^a-z0-9-]+/g, '-') + '-' + orgId.slice(0, 6))
          }
        });
      }

      for (const u of userRows) {
        await tx.user.upsert({
          where: { id: u.id },
          update: {
            email: u.email.toLowerCase().trim(),
            passwordHash: u.passwordHash,
            fullName: u.fullName,
            isActive: Boolean(u.isActive),
            role: u.role || 'OPERATOR',
            organizationId: u.organizationId || 'default-org'
          },
          create: {
            id: u.id,
            email: u.email.toLowerCase().trim(),
            passwordHash: u.passwordHash,
            fullName: u.fullName,
            isActive: Boolean(u.isActive),
            role: u.role || 'OPERATOR',
            organizationId: u.organizationId || 'default-org'
          }
        });
      }

      for (const st of studioRows) {
        await tx.studio.upsert({
          where: { id: st.id },
          update: { name: st.name, description: st.description || null },
          create: {
            id: st.id,
            organizationId: st.organizationId,
            name: st.name,
            description: st.description || null
          }
        });
      }

      for (const s of stationRows) {
        const slug = `${s.slug || 'station'}-${s.id.slice(0, 8)}`;
        await tx.station.upsert({
          where: { id: s.id },
          update: {
            name: s.name,
            ipAddress: s.ipAddress || '127.0.0.1',
            obsPort: Number(s.obsPort || 4455),
            encryptedPassword: s.encryptedPassword || null,
            status: s.status || 'OFFLINE',
            streamStatus: s.streamStatus || 'STOPPED',
            recordStatus: s.recordStatus || 'STOPPED'
          },
          create: {
            id: s.id,
            organizationId: s.organizationId,
            studioId: s.studioId || null,
            name: s.name,
            slug,
            description: s.description || null,
            ipAddress: s.ipAddress || '127.0.0.1',
            obsPort: Number(s.obsPort || 4455),
            encryptedPassword: s.encryptedPassword || null,
            status: s.status || 'OFFLINE',
            streamStatus: s.streamStatus || 'STOPPED',
            recordStatus: s.recordStatus || 'STOPPED'
          }
        });
      }

      for (const a of mediaAssets) {
        await tx.mediaAsset.upsert({
          where: { id: a.id },
          update: {
            title: a.title,
            processingStatus: a.processingStatus,
            broadcastCompatibility: a.broadcastCompatibility
          },
          create: {
            id: a.id,
            organizationId: a.organizationId,
            folder: a.folder || '',
            title: a.title,
            description: a.description || '',
            category: a.category,
            kind: a.kind,
            tags: JSON.parse(a.tags || '[]'),
            channelIds: JSON.parse(a.channelIds || '[]'),
            originalFilename: a.originalFilename,
            storageKey: a.storageKey,
            thumbnailKey: a.thumbnailKey || null,
            previewKey: a.previewKey || null,
            sizeBytes: BigInt(a.sizeBytes),
            checksumSha256: a.checksumSha256,
            mimeType: a.mimeType,
            containerFormat: a.containerFormat || null,
            videoCodec: a.videoCodec || null,
            audioCodec: a.audioCodec || null,
            width: a.width ?? null,
            height: a.height ?? null,
            frameRate: a.frameRate ?? null,
            durationSeconds: a.durationSeconds ?? null,
            bitrateBps: a.bitrateBps ? BigInt(a.bitrateBps) : null,
            audioChannels: a.audioChannels ?? null,
            sampleRateHz: a.sampleRateHz ?? null,
            hasVideo: Boolean(a.hasVideo),
            hasAudio: Boolean(a.hasAudio),
            uploadStatus: a.uploadStatus,
            processingStatus: a.processingStatus,
            broadcastCompatibility: a.broadcastCompatibility,
            compatibilityNotes: JSON.parse(a.compatibilityNotes || '[]'),
            errorReason: a.errorReason || null,
            createdByUserId: a.createdByUserId
          }
        });
      }

      for (const u of uploadSessions) {
        await tx.mediaUploadSession.upsert({
          where: { id: u.id },
          update: {
            receivedBytes: BigInt(u.receivedBytes),
            status: u.status,
            assetId: u.assetId || null
          },
          create: {
            id: u.id,
            organizationId: u.organizationId,
            createdByUserId: u.createdByUserId,
            title: u.title,
            description: u.description || '',
            folder: u.folder || '',
            category: u.category,
            tags: JSON.parse(u.tags || '[]'),
            channelIds: JSON.parse(u.channelIds || '[]'),
            originalFilename: u.originalFilename,
            declaredMimeType: u.declaredMimeType || '',
            expectedSizeBytes: BigInt(u.expectedSizeBytes),
            expectedChecksumSha256: u.expectedChecksumSha256 || null,
            receivedBytes: BigInt(u.receivedBytes),
            chunkSizeBytes: Number(u.chunkSizeBytes),
            uploadKey: u.uploadKey,
            status: u.status,
            assetId: u.assetId || null,
            errorReason: u.errorReason || null,
            expiresAt: BigInt(u.expiresAt)
          }
        });
      }

      for (const p of mediaPlaylists) {
        await tx.mediaPlaylist.upsert({
          where: { id: p.id },
          update: { name: p.name, items: JSON.parse(p.items || '[]') },
          create: {
            id: p.id,
            organizationId: p.organizationId,
            name: p.name,
            description: p.description || '',
            kind: p.kind,
            channelId: p.channelId || null,
            items: JSON.parse(p.items || '[]'),
            createdByUserId: p.createdByUserId
          }
        });
      }

      for (const vs of videoSources) {
        await tx.videoSource.upsert({
          where: { id: vs.id },
          update: {
            name: vs.name,
            connectionStatus: vs.connectionStatus,
            availabilityStatus: vs.availabilityStatus
          },
          create: {
            id: vs.id,
            organizationId: vs.organizationId,
            stationId: vs.stationId || null,
            name: vs.name,
            description: vs.description || '',
            sourceType: vs.sourceType,
            mediaAssetId: vs.mediaAssetId || null,
            playlistId: vs.playlistId || null,
            streamUrl: vs.streamUrl || null,
            encryptedSecret: vs.encryptedSecret || null,
            serverFilePath: vs.serverFilePath || null,
            connectionStatus: vs.connectionStatus,
            availabilityStatus: vs.availabilityStatus,
            width: vs.width ?? null,
            height: vs.height ?? null,
            frameRate: vs.frameRate ?? null,
            videoCodec: vs.videoCodec || null,
            audioCodec: vs.audioCodec || null,
            hasAudio: Boolean(vs.hasAudio),
            previewThumbnailKey: vs.previewThumbnailKey || null,
            reconnectEnabled: Boolean(vs.reconnectEnabled),
            maxRetries: Number(vs.maxRetries ?? 5),
            retryCount: Number(vs.retryCount ?? 0),
            backoffBaseMs: Number(vs.backoffBaseMs ?? 2000),
            backoffMaxMs: Number(vs.backoffMaxMs ?? 30000),
            fallbackSourceId: vs.fallbackSourceId || null,
            fallbackAssetId: vs.fallbackAssetId || null,
            fallbackMode: vs.fallbackMode || 'SLATE',
            createdByUserId: vs.createdByUserId
          }
        });
      }

      for (const asrc of audioSources) {
        await tx.audioSource.upsert({
          where: { id: asrc.id },
          update: {
            name: asrc.name,
            state: asrc.state,
            volumeLinear: Number(asrc.volumeLinear ?? 1),
            gainDb: Number(asrc.gainDb ?? 0),
            muted: Boolean(asrc.muted),
            soloMonitoring: Boolean(asrc.soloMonitoring),
            enabled: Boolean(asrc.enabled),
            priority: Number(asrc.priority ?? 50),
            encryptedSecret: asrc.encryptedSecret || null
          },
          create: {
            id: asrc.id,
            organizationId: asrc.organizationId,
            channelId: asrc.channelId,
            name: asrc.name,
            description: asrc.description || '',
            sourceType: asrc.sourceType,
            mediaAssetId: asrc.mediaAssetId || null,
            playlistId: asrc.playlistId || null,
            videoSourceId: asrc.videoSourceId || null,
            obsInputName: asrc.obsInputName || null,
            streamUrl: asrc.streamUrl || null,
            encryptedSecret: asrc.encryptedSecret || null,
            enabled: Boolean(asrc.enabled),
            muted: Boolean(asrc.muted),
            soloMonitoring: Boolean(asrc.soloMonitoring),
            volumeLinear: Number(asrc.volumeLinear ?? 1),
            gainDb: Number(asrc.gainDb ?? 0),
            delayMs: Number(asrc.delayMs ?? 0),
            fadeInMs: Number(asrc.fadeInMs ?? 500),
            fadeOutMs: Number(asrc.fadeOutMs ?? 500),
            priority: Number(asrc.priority ?? 50),
            duckingTrigger: Boolean(asrc.duckingTrigger),
            duckingTarget: Boolean(asrc.duckingTarget),
            repeatMode: asrc.repeatMode || 'REPEAT_PLAYLIST',
            shuffleEnabled: Boolean(asrc.shuffleEnabled),
            crossfadeMs: Number(asrc.crossfadeMs ?? 1500),
            currentTrackIndex: Number(asrc.currentTrackIndex ?? 0),
            currentTrackAssetId: asrc.currentTrackAssetId || null,
            playbackPositionMs: Number(asrc.playbackPositionMs ?? 0),
            remainingDurationMs: asrc.remainingDurationMs != null ? Number(asrc.remainingDurationMs) : null,
            state: asrc.state || 'ONLINE',
            measuredRmsDbfs: Number(asrc.measuredRmsDbfs ?? -90),
            measuredPeakDbfs: Number(asrc.measuredPeakDbfs ?? -90),
            clippingDetected: Boolean(asrc.clippingDetected),
            codec: asrc.codec || 'aac',
            sampleRateHz: Number(asrc.sampleRateHz ?? 48000),
            channels: Number(asrc.channels ?? 2),
            streamMetadata: asrc.streamMetadata || null,
            reconnectEnabled: Boolean(asrc.reconnectEnabled),
            maxRetries: Number(asrc.maxRetries ?? 5),
            retryCount: Number(asrc.retryCount ?? 0),
            backoffBaseMs: Number(asrc.backoffBaseMs ?? 2000),
            backoffMaxMs: Number(asrc.backoffMaxMs ?? 30000),
            fallbackSourceId: asrc.fallbackSourceId || null,
            fallbackAssetId: asrc.fallbackAssetId || null,
            lastConnectedAt: asrc.lastConnectedAt ? new Date(asrc.lastConnectedAt) : null,
            lastError: asrc.lastError || null,
            createdByUserId: asrc.createdByUserId
          }
        });
      }

      for (const cfg of audioMixerConfigs) {
        await tx.audioMixerConfig.upsert({
          where: {
            channelId_organizationId: {
              channelId: cfg.channelId,
              organizationId: cfg.organizationId
            }
          },
          update: {
            routingMode: cfg.routingMode,
            masterVolumeLinear: Number(cfg.masterVolumeLinear ?? 1),
            masterGainDb: Number(cfg.masterGainDb ?? 0),
            masterMuted: Boolean(cfg.masterMuted),
            adAudioPolicy: cfg.adAudioPolicy
          },
          create: {
            channelId: cfg.channelId,
            organizationId: cfg.organizationId,
            masterVolumeLinear: Number(cfg.masterVolumeLinear ?? 1),
            masterGainDb: Number(cfg.masterGainDb ?? 0),
            masterMuted: Boolean(cfg.masterMuted),
            routingMode: cfg.routingMode || 'MIX_VIDEO_AND_EXTERNAL_AUDIO',
            cameraAudioMuted: Boolean(cfg.cameraAudioMuted),
            cameraAudioGainDb: Number(cfg.cameraAudioGainDb ?? -6),
            duckingEnabled: Boolean(cfg.duckingEnabled),
            duckingThresholdDbfs: Number(cfg.duckingThresholdDbfs ?? -32),
            duckingReductionDb: Number(cfg.duckingReductionDb ?? -12),
            duckingAttackMs: Number(cfg.duckingAttackMs ?? 120),
            duckingHoldMs: Number(cfg.duckingHoldMs ?? 300),
            duckingReleaseMs: Number(cfg.duckingReleaseMs ?? 600),
            crossfadeDurationMs: Number(cfg.crossfadeDurationMs ?? 1500),
            adAudioPolicy: cfg.adAudioPolicy || 'REPLACE_MUSIC_PAUSE_PLAYLIST',
            adActive: Boolean(cfg.adActive),
            peakLimiterCeilingDbfs: Number(cfg.peakLimiterCeilingDbfs ?? -1),
            loudnessNormalization: Boolean(cfg.loudnessNormalization),
            targetLoudnessLufs: Number(cfg.targetLoudnessLufs ?? -23),
            silenceThresholdDbfs: Number(cfg.silenceThresholdDbfs ?? -60),
            silenceTimeoutSeconds: Number(cfg.silenceTimeoutSeconds ?? 10),
            fallbackSourceId: cfg.fallbackSourceId || null,
            fallbackAssetId: cfg.fallbackAssetId || null,
            outputCodec: cfg.outputCodec || 'aac_lc',
            outputSampleRateHz: Number(cfg.outputSampleRateHz ?? 48000),
            outputChannels: Number(cfg.outputChannels ?? 2),
            outputBitrateKbps: Number(cfg.outputBitrateKbps ?? 192),
            measuredMasterRmsDbfs: Number(cfg.measuredMasterRmsDbfs ?? -90),
            measuredMasterPeakDbfs: Number(cfg.measuredMasterPeakDbfs ?? -90),
            masterClippingPrevented: Boolean(cfg.masterClippingPrevented),
            updatedByUserId: cfg.updatedByUserId || null
          }
        });
      }

      for (const pcfg of channelPlayoutConfigs) {
        await tx.channelPlayoutConfig.upsert({
          where: {
            channelId_organizationId: {
              channelId: pcfg.channelId,
              organizationId: pcfg.organizationId
            }
          },
          update: {
            playoutMode: pcfg.playoutMode,
            desiredState: pcfg.desiredState,
            runtimeState: pcfg.runtimeState,
            revision: Number(pcfg.revision ?? 1)
          },
          create: {
            channelId: pcfg.channelId,
            organizationId: pcfg.organizationId,
            playoutMode: pcfg.playoutMode || 'CAMERA_ROTATION',
            desiredState: pcfg.desiredState || 'STOPPED',
            runtimeState: pcfg.runtimeState || 'STOPPED',
            autoStart: Boolean(pcfg.autoStart),
            width: Number(pcfg.width ?? 1920),
            height: Number(pcfg.height ?? 1080),
            frameRate: Number(pcfg.frameRate ?? 25),
            videoCodec: pcfg.videoCodec || 'h264',
            videoBitrateKbps: Number(pcfg.videoBitrateKbps ?? 4500),
            gopFrames: Number(pcfg.gopFrames ?? 50),
            audioCodec: pcfg.audioCodec || 'aac_lc',
            audioSampleRateHz: Number(pcfg.audioSampleRateHz ?? 48000),
            audioChannels: Number(pcfg.audioChannels ?? 2),
            audioBitrateKbps: Number(pcfg.audioBitrateKbps ?? 192),
            hwAccelMode: pcfg.hwAccelMode || 'AUTO_WITH_SW_FALLBACK',
            activeEncoder: pcfg.activeEncoder || 'x264enc',
            cameraSequence: JSON.parse(pcfg.cameraSequence || '[]'),
            cameraRepeat: Boolean(pcfg.cameraRepeat),
            activeCameraIndex: Number(pcfg.activeCameraIndex ?? 0),
            currentSourceId: pcfg.currentSourceId || null,
            movieQueue: JSON.parse(pcfg.movieQueue || '[]'),
            movieRepeat: Boolean(pcfg.movieRepeat),
            activeMovieIndex: Number(pcfg.activeMovieIndex ?? 0),
            currentMediaAssetId: pcfg.currentMediaAssetId || null,
            playbackPositionMs: Number(pcfg.playbackPositionMs ?? 0),
            remainingDurationMs: pcfg.remainingDurationMs != null ? Number(pcfg.remainingDurationMs) : null,
            paused: Boolean(pcfg.paused),
            adSchedulePolicy: JSON.parse(pcfg.adSchedulePolicy || '{}'),
            adState: JSON.parse(pcfg.adState || '{}'),
            graphicsConfig: JSON.parse(pcfg.graphicsConfig || '{}'),
            fallbackConfig: JSON.parse(pcfg.fallbackConfig || '{}'),
            fallbackActive: Boolean(pcfg.fallbackActive),
            emergencyActive: Boolean(pcfg.emergencyActive),
            emergencySourceId: pcfg.emergencySourceId || null,
            networkAllowlist: JSON.parse(pcfg.networkAllowlist || '[]'),
            outputUdpPort: pcfg.outputUdpPort != null ? Number(pcfg.outputUdpPort) : null,
            outputHlsEnabled: Boolean(pcfg.outputHlsEnabled),
            outputSrtUrl: pcfg.outputSrtUrl || null,
            workerSessionId: pcfg.workerSessionId || null,
            workerPid: pcfg.workerPid != null ? Number(pcfg.workerPid) : null,
            restartCount: Number(pcfg.restartCount ?? 0),
            lastHeartbeatAt: pcfg.lastHeartbeatAt ? new Date(pcfg.lastHeartbeatAt) : null,
            lastOutputAt: pcfg.lastOutputAt ? new Date(pcfg.lastOutputAt) : null,
            lastRecoveryAt: pcfg.lastRecoveryAt ? new Date(pcfg.lastRecoveryAt) : null,
            lastError: pcfg.lastError || null,
            revision: Number(pcfg.revision ?? 1),
            updatedByUserId: pcfg.updatedByUserId || null
          }
        });
      }

      for (const srev of channelScheduleRevisions) {
        await tx.channelScheduleRevision.upsert({
          where: { id: srev.id },
          update: {
            lifecycleState: srev.lifecycleState,
            events: JSON.parse(srev.events || '[]')
          },
          create: {
            id: srev.id,
            organizationId: srev.organizationId,
            channelId: srev.channelId,
            revisionNumber: Number(srev.revisionNumber),
            name: srev.name || 'Broadcast Schedule',
            timezone: srev.timezone || 'UTC',
            lifecycleState: srev.lifecycleState || 'DRAFT',
            activationPolicy: srev.activationPolicy || 'APPLY_NEXT_BOUNDARY',
            effectiveFromUtc: srev.effectiveFromUtc ? new Date(srev.effectiveFromUtc) : null,
            gapPolicy: srev.gapPolicy || 'FALLBACK_PLAYLIST',
            gapFallbackAssetId: srev.gapFallbackAssetId || null,
            gapFallbackSourceId: srev.gapFallbackSourceId || null,
            gapFallbackPlaylistId: srev.gapFallbackPlaylistId || null,
            events: JSON.parse(srev.events || '[]'),
            templates: JSON.parse(srev.templates || '[]'),
            validationSummary: JSON.parse(srev.validationSummary || '{}'),
            publishedByUserId: srev.publishedByUserId || null,
            publishedAt: srev.publishedAt ? new Date(srev.publishedAt) : null,
            createdByUserId: srev.createdByUserId
          }
        });
      }

      for (const sexec of channelSchedulerExecutionStates) {
        await tx.channelSchedulerExecutionState.upsert({
          where: {
            channelId_organizationId: {
              channelId: sexec.channelId,
              organizationId: sexec.organizationId
            }
          },
          update: {
            activeRevisionId: sexec.activeRevisionId || null,
            activeRevisionNumber: Number(sexec.activeRevisionNumber ?? 0),
            schedulerRunning: Boolean(sexec.schedulerRunning)
          },
          create: {
            channelId: sexec.channelId,
            organizationId: sexec.organizationId,
            activeRevisionId: sexec.activeRevisionId || null,
            activeRevisionNumber: Number(sexec.activeRevisionNumber ?? 0),
            pendingRevisionId: sexec.pendingRevisionId || null,
            pendingActivationPolicy: sexec.pendingActivationPolicy || null,
            pendingEffectiveAtUtc: sexec.pendingEffectiveAtUtc ? new Date(sexec.pendingEffectiveAtUtc) : null,
            timezone: sexec.timezone || 'UTC',
            schedulerRunning: Boolean(sexec.schedulerRunning),
            holdActive: Boolean(sexec.holdActive),
            emergencyOverrideActive: Boolean(sexec.emergencyOverrideActive),
            manualOverrideActive: Boolean(sexec.manualOverrideActive),
            overrideSourceId: sexec.overrideSourceId || null,
            overrideExpiresAtUtc: sexec.overrideExpiresAtUtc ? new Date(sexec.overrideExpiresAtUtc) : null,
            currentTrackStates: JSON.parse(sexec.currentTrackStates || '{}'),
            claimedOccurrenceIds: JSON.parse(sexec.claimedOccurrenceIds || '[]'),
            interruptedProgramState: JSON.parse(sexec.interruptedProgramState || '{}'),
            gapFallbackActive: Boolean(sexec.gapFallbackActive),
            leaseOwnerId: sexec.leaseOwnerId || null,
            leaseExpiresAt: BigInt(sexec.leaseExpiresAt || 0),
            lastHeartbeatAt: sexec.lastHeartbeatAt ? new Date(sexec.lastHeartbeatAt) : null,
            lastReconciledAt: sexec.lastReconciledAt ? new Date(sexec.lastReconciledAt) : null
          }
        });
      }

      for (const arun of channelAsRunLogs) {
        await tx.channelAsRunLog.upsert({
          where: { occurrenceId: arun.occurrenceId },
          update: {
            status: arun.status,
            workerConfirmed: Boolean(arun.workerConfirmed)
          },
          create: {
            id: arun.id,
            organizationId: arun.organizationId,
            channelId: arun.channelId,
            revisionId: arun.revisionId || null,
            revisionNumber: Number(arun.revisionNumber ?? 0),
            eventId: arun.eventId,
            occurrenceId: arun.occurrenceId,
            trackType: arun.trackType,
            executionMode: arun.executionMode,
            title: arun.title,
            category: arun.category || 'PROGRAM',
            mediaAssetId: arun.mediaAssetId || null,
            videoSourceId: arun.videoSourceId || null,
            audioSourceId: arun.audioSourceId || null,
            plannedStartUtc: new Date(arun.plannedStartUtc),
            actualStartUtc: new Date(arun.actualStartUtc),
            plannedEndUtc: new Date(arun.plannedEndUtc),
            actualEndUtc: arun.actualEndUtc ? new Date(arun.actualEndUtc) : null,
            plannedDurationMs: Number(arun.plannedDurationMs),
            actualDurationMs: arun.actualDurationMs != null ? Number(arun.actualDurationMs) : null,
            status: arun.status || 'RUNNING',
            interruptionReason: arun.interruptionReason || null,
            resumeOffsetMs: Number(arun.resumeOffsetMs ?? 0),
            workerConfirmed: Boolean(arun.workerConfirmed),
            details: JSON.parse(arun.details || '{}')
          }
        });
      }

      for (const log of auditLogs) {
        let parsedDetails = {};
        try {
          parsedDetails = log.details ? JSON.parse(log.details) : {};
        } catch {
          parsedDetails = { raw: String(log.details) };
        }
        await tx.auditLog.upsert({
          where: { id: log.id },
          update: {},
          create: {
            id: log.id,
            organizationId: log.organizationId,
            userId: null,
            action: log.action,
            resourceType: log.resourceType,
            resourceId: log.resourceId || null,
            details: { ...parsedDetails, ...(log.userId ? { actorId: log.userId } : {}) },
            ipAddress: log.ipAddress || null
          }
        });
      }
    });

    const [
      mysqlUsers,
      mysqlStations,
      mysqlMedia,
      mysqlPlaylists,
      mysqlSources,
      mysqlAudioSources,
      mysqlAudioMixerConfigs,
      mysqlChannelPlayoutConfigs,
      mysqlChannelScheduleRevisions,
      mysqlChannelSchedulerExecutionStates,
      mysqlChannelAsRunLogs,
      mysqlAudits
    ] = await Promise.all([
      prisma.user.count(),
      prisma.station.count(),
      prisma.mediaAsset.count(),
      prisma.mediaPlaylist.count(),
      prisma.videoSource.count(),
      prisma.audioSource.count(),
      prisma.audioMixerConfig.count(),
      prisma.channelPlayoutConfig.count(),
      prisma.channelScheduleRevision.count(),
      prisma.channelSchedulerExecutionState.count(),
      prisma.channelAsRunLog.count(),
      prisma.auditLog.count()
    ]);

    return {
      sqliteCounts: {
        users: userRows.length,
        stations: stationRows.length,
        mediaAssets: mediaAssets.length,
        mediaPlaylists: mediaPlaylists.length,
        videoSources: videoSources.length,
        audioSources: audioSources.length,
        audioMixerConfigs: audioMixerConfigs.length,
        channelPlayoutConfigs: channelPlayoutConfigs.length,
        channelScheduleRevisions: channelScheduleRevisions.length,
        channelSchedulerExecutionStates: channelSchedulerExecutionStates.length,
        channelAsRunLogs: channelAsRunLogs.length,
        auditLogs: auditLogs.length
      },
      mysqlCounts: {
        users: mysqlUsers,
        stations: mysqlStations,
        mediaAssets: mysqlMedia,
        mediaPlaylists: mysqlPlaylists,
        videoSources: mysqlSources,
        audioSources: mysqlAudioSources,
        audioMixerConfigs: mysqlAudioMixerConfigs,
        channelPlayoutConfigs: mysqlChannelPlayoutConfigs,
        channelScheduleRevisions: mysqlChannelScheduleRevisions,
        channelSchedulerExecutionStates: mysqlChannelSchedulerExecutionStates,
        channelAsRunLogs: mysqlChannelAsRunLogs,
        auditLogs: mysqlAudits
      }
    };
  } finally {
    sqlite.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const sqlitePath = process.argv[2] || process.env.SQLITE_DB_PATH;
  const mysqlUrl = process.argv[3] || process.env.DATABASE_URL;
  const summary = await rehearseSqliteToMysqlMigration({ sqlitePath, mysqlUrl });
  console.log(JSON.stringify(summary, null, 2));
}
