import { randomUUID } from 'node:crypto';
import {
  IAuditLogRepository,
  IAudioRepository,
  IBroadcastSchedulerRepository,
  IChannelPlayoutRepository,
  IMediaRepository,
  IStationRepository,
  IUserRepository,
  IVideoSourceRepository,
  Station,
  User
} from '@mcr/domain';
import {
  AUDIO_SOURCE_STATES,
  MEDIA_BROADCAST_COMPATIBILITY,
  MEDIA_PROCESSING_STATUS,
  MEDIA_UPLOAD_STATUS,
  SCHEDULE_LIFECYCLE_STATES,
  VIDEO_SOURCE_AVAILABILITY,
  VIDEO_SOURCE_CONNECTION_STATUS
} from '@mcr/shared';
import { defaultChannelMixerConfig, mapAudioSourceRow, mapMixerConfigRow } from './sqlite-audio-repository.js';
import { defaultChannelPlayoutConfig, mapChannelPlayoutConfigRow } from './sqlite-channel-playout-repository.js';
import {
  defaultSchedulerExecutionState,
  mapAsRunLogRow,
  mapScheduleRevisionRow,
  mapSchedulerExecutionStateRow
} from './sqlite-broadcast-scheduler-repository.js';
import { env } from '../../config/env.js';
import { hasPermission } from '../../presentation/middlewares/rbac.middleware.js';
import { getPrismaClient } from '../database/mysql-prisma.js';
import { managedAccountRoles } from '../security/account-management.js';

function toJsonArray(val) {
  if (Array.isArray(val)) return val;
  if (typeof val === 'string') {
    try {
      const parsed = JSON.parse(val);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function mapPrismaMediaAsset(row) {
  if (!row) return null;
  return {
    id: row.id,
    organizationId: row.organizationId,
    folder: row.folder || '',
    title: row.title,
    description: row.description || '',
    category: row.category,
    kind: row.kind,
    tags: toJsonArray(row.tags),
    channelIds: toJsonArray(row.channelIds),
    originalFilename: row.originalFilename,
    storageKey: row.storageKey,
    thumbnailKey: row.thumbnailKey || null,
    previewKey: row.previewKey || null,
    sizeBytes: Number(row.sizeBytes),
    checksumSha256: row.checksumSha256,
    mimeType: row.mimeType,
    containerFormat: row.containerFormat || null,
    videoCodec: row.videoCodec || null,
    audioCodec: row.audioCodec || null,
    width: row.width ?? null,
    height: row.height ?? null,
    frameRate: row.frameRate ?? null,
    durationSeconds: row.durationSeconds ?? null,
    bitrateBps: row.bitrateBps !== null && row.bitrateBps !== undefined ? Number(row.bitrateBps) : null,
    audioChannels: row.audioChannels ?? null,
    sampleRateHz: row.sampleRateHz ?? null,
    hasVideo: Boolean(row.hasVideo),
    hasAudio: Boolean(row.hasAudio),
    uploadStatus: row.uploadStatus,
    processingStatus: row.processingStatus,
    broadcastCompatibility: row.broadcastCompatibility,
    compatibilityNotes: toJsonArray(row.compatibilityNotes),
    errorReason: row.errorReason || null,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt)
  };
}

function mapPrismaUploadSession(row) {
  if (!row) return null;
  return {
    id: row.id,
    organizationId: row.organizationId,
    createdByUserId: row.createdByUserId,
    title: row.title,
    description: row.description || '',
    folder: row.folder || '',
    category: row.category,
    tags: toJsonArray(row.tags),
    channelIds: toJsonArray(row.channelIds),
    originalFilename: row.originalFilename,
    declaredMimeType: row.declaredMimeType || '',
    expectedSizeBytes: Number(row.expectedSizeBytes),
    expectedChecksumSha256: row.expectedChecksumSha256 || null,
    receivedBytes: Number(row.receivedBytes),
    chunkSizeBytes: Number(row.chunkSizeBytes),
    uploadKey: row.uploadKey,
    status: row.status,
    assetId: row.assetId || null,
    errorReason: row.errorReason || null,
    expiresAt: Number(row.expiresAt),
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt)
  };
}

function mapPrismaVideoSource(row) {
  if (!row) return null;
  return {
    id: row.id,
    organizationId: row.organizationId,
    stationId: row.stationId || null,
    name: row.name,
    description: row.description || '',
    sourceType: row.sourceType,
    mediaAssetId: row.mediaAssetId || null,
    playlistId: row.playlistId || null,
    streamUrl: row.streamUrl || null,
    hasSecret: Boolean(row.encryptedSecret),
    serverFilePath: row.serverFilePath || null,
    connectionStatus: row.connectionStatus,
    availabilityStatus: row.availabilityStatus,
    width: row.width ?? null,
    height: row.height ?? null,
    frameRate: row.frameRate ?? null,
    videoCodec: row.videoCodec || null,
    audioCodec: row.audioCodec || null,
    hasAudio: Boolean(row.hasAudio),
    previewThumbnailKey: row.previewThumbnailKey || null,
    lastConnectedAt: row.lastConnectedAt ? new Date(row.lastConnectedAt).toISOString() : null,
    lastProbedAt: row.lastProbedAt ? new Date(row.lastProbedAt).toISOString() : null,
    lastError: row.lastError || null,
    reconnectEnabled: Boolean(row.reconnectEnabled),
    maxRetries: Number(row.maxRetries ?? 5),
    retryCount: Number(row.retryCount ?? 0),
    backoffBaseMs: Number(row.backoffBaseMs ?? 2000),
    backoffMaxMs: Number(row.backoffMaxMs ?? 30000),
    fallbackSourceId: row.fallbackSourceId || null,
    fallbackAssetId: row.fallbackAssetId || null,
    fallbackMode: row.fallbackMode || 'SLATE',
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt)
  };
}

async function ensureOrganization(tx, organizationId) {
  const id = organizationId || 'default-org';
  await tx.organization.upsert({
    where: { id },
    update: {},
    create: {
      id,
      name: id,
      slug: id.toLowerCase().replace(/[^a-z0-9-]+/g, '-') + '-' + id.slice(0, 6)
    }
  });
  return id;
}

export class PrismaUserRepository extends IUserRepository {
  constructor(prisma = getPrismaClient()) {
    super();
    this.prisma = prisma;
  }

  async findById(id) {
    const row = await this.prisma.user.findUnique({ where: { id } });
    return row ? new User(row) : null;
  }

  async findByEmail(email) {
    const normalized = email.toLowerCase().trim();
    const row = await this.prisma.user.findUnique({ where: { email: normalized } });
    return row ? { ...row, isActive: Boolean(row.isActive) } : null;
  }

  async listByOrganization(organizationId) {
    const rows = await this.prisma.user.findMany({
      where: { organizationId: organizationId || 'default-org' },
      orderBy: { fullName: 'asc' },
      select: { id: true, email: true, fullName: true, role: true, isActive: true }
    });
    return rows;
  }

  async create(data, { actor } = {}) {
    const id = data.id || randomUUID();
    const email = data.email.toLowerCase().trim();
    const role = data.role || 'OPERATOR';
    const organizationId = data.organizationId || 'default-org';

    return await this.prisma.$transaction(async tx => {
      await ensureOrganization(tx, organizationId);
      if (actor) {
        const actorRow = await tx.user.findUnique({ where: { id: actor.id } });
        if (!actorRow || !actorRow.isActive || (actorRow.organizationId || 'default-org') !== organizationId ||
            !hasPermission(actorRow.role, 'user:manage')) {
          throw Object.assign(new Error('Access denied.'), { status: 403 });
        }
        if (actor.passwordHash && actorRow.passwordHash !== actor.passwordHash) {
          throw Object.assign(new Error('Current password is incorrect.'), { status: 403 });
        }
        if (!managedAccountRoles.includes(role)) {
          throw Object.assign(new Error('Role is not assignable.'), { status: 403 });
        }
      }
      const exists = await tx.user.findUnique({ where: { email } });
      if (exists) {
        throw Object.assign(new Error('Email is already registered'), { status: 409 });
      }
      const created = await tx.user.create({
        data: {
          id,
          email,
          passwordHash: data.passwordHash,
          fullName: data.fullName,
          isActive: data.isActive !== undefined ? Boolean(data.isActive) : true,
          role,
          organizationId
        }
      });
      if (actor) {
        await tx.auditLog.create({
          data: {
            id: randomUUID(),
            organizationId,
            userId: actor.id,
            action: 'USER_CREATED',
            resourceType: 'User',
            resourceId: id,
            details: { role },
            ipAddress: actor.ipAddress || null
          }
        });
      }
      return new User(created);
    });
  }

  async update(id, updateData) {
    const updated = await this.prisma.user.update({
      where: { id },
      data: updateData
    });
    return new User(updated);
  }
}

export class PrismaAuditRepository extends IAuditLogRepository {
  constructor(prisma = getPrismaClient()) {
    super();
    this.prisma = prisma;
  }

  async create({ organizationId, userId = null, action, resourceType, resourceId = null, details = {}, ipAddress = null }) {
    return await this.prisma.$transaction(async tx => {
      const orgId = await ensureOrganization(tx, organizationId);
      const record = await tx.auditLog.create({
        data: {
          id: randomUUID(),
          organizationId: orgId,
          userId: null, // keep independent of foreign-key constraint if userId is synthetic/deleted
          action,
          resourceType,
          resourceId,
          details: typeof details === 'string' ? JSON.parse(details) : { ...details, ...(userId ? { actorId: userId } : {}) },
          ipAddress
        }
      });
      return {
        ...record,
        userId: userId ?? record.userId,
        createdAt: record.createdAt.toISOString()
      };
    });
  }

  async findByOrganizationId(organizationId, options = {}) {
    const limit = options.limit || 50;
    const rows = await this.prisma.auditLog.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      take: limit
    });
    return rows.map(r => ({
      ...r,
      userId: r.userId || r.details?.actorId || null,
      createdAt: r.createdAt.toISOString()
    }));
  }
}

export class PrismaPairingRepository {
  constructor(prisma = getPrismaClient()) {
    this.prisma = prisma;
  }

  async createToken({ stationId, pairingCode, tokenHash, expiresAt, createdByUserId }) {
    return await this.prisma.$transaction(async tx => {
      const conflict = await tx.devicePairingToken.findFirst({
        where: {
          pairingCode,
          usedAt: null,
          expiresAt: { gt: new Date() }
        }
      });
      if (conflict) return null;
      const created = await tx.devicePairingToken.create({
        data: {
          id: randomUUID(),
          stationId,
          pairingCode,
          tokenHash,
          expiresAt: expiresAt instanceof Date ? expiresAt : new Date(expiresAt),
          createdByUserId
        }
      });
      return created;
    });
  }

  async findByCode(pairingCode) {
    return await this.prisma.devicePairingToken.findFirst({
      where: {
        pairingCode,
        usedAt: null,
        expiresAt: { gt: new Date() }
      }
    });
  }
}

export class PrismaMediaRepository extends IMediaRepository {
  constructor(prisma = getPrismaClient()) {
    super();
    this.prisma = prisma;
  }

  async getStorageUsage(organizationId) {
    const nowMs = BigInt(Date.now());
    const [storedAgg, reservedAgg] = await Promise.all([
      this.prisma.mediaAsset.aggregate({
        where: { organizationId },
        _sum: { sizeBytes: true },
        _count: { id: true }
      }),
      this.prisma.mediaUploadSession.aggregate({
        where: { organizationId, status: 'UPLOADING', expiresAt: { gt: nowMs } },
        _sum: { expectedSizeBytes: true },
        _count: { id: true }
      })
    ]);
    const storedBytes = Number(storedAgg._sum.sizeBytes ?? 0n);
    const reservedUploadBytes = Number(reservedAgg._sum.expectedSizeBytes ?? 0n);
    const quotaBytes = env.MEDIA_ORG_QUOTA_BYTES;
    return {
      storedBytes,
      assetCount: storedAgg._count.id,
      reservedUploadBytes,
      activeUploadSessions: reservedAgg._count.id,
      totalCommittedBytes: storedBytes + reservedUploadBytes,
      quotaBytes,
      remainingQuotaBytes: Math.max(0, quotaBytes - (storedBytes + reservedUploadBytes))
    };
  }

  async createUploadSession(session, actor) {
    const id = session.id || randomUUID();
    return await this.prisma.$transaction(async tx => {
      await ensureOrganization(tx, session.organizationId);
      await tx.mediaUploadSession.updateMany({
        where: { status: 'UPLOADING', expiresAt: { lte: BigInt(Date.now()) } },
        data: { status: 'EXPIRED' }
      });
      const storedAgg = await tx.mediaAsset.aggregate({
        where: { organizationId: session.organizationId },
        _sum: { sizeBytes: true }
      });
      const reservedAgg = await tx.mediaUploadSession.aggregate({
        where: { organizationId: session.organizationId, status: 'UPLOADING', expiresAt: { gt: BigInt(Date.now()) } },
        _sum: { expectedSizeBytes: true }
      });
      const committed = Number(storedAgg._sum.sizeBytes ?? 0n) + Number(reservedAgg._sum.expectedSizeBytes ?? 0n);
      if (committed + session.expectedSizeBytes > env.MEDIA_ORG_QUOTA_BYTES) {
        throw Object.assign(new Error('This upload exceeds the organization media storage quota'), { statusCode: 409 });
      }
      const created = await tx.mediaUploadSession.create({
        data: {
          id,
          organizationId: session.organizationId,
          createdByUserId: session.createdByUserId,
          title: session.title,
          description: session.description || '',
          folder: session.folder || '',
          category: session.category,
          tags: session.tags || [],
          channelIds: session.channelIds || [],
          originalFilename: session.originalFilename,
          declaredMimeType: session.declaredMimeType || '',
          expectedSizeBytes: BigInt(session.expectedSizeBytes),
          expectedChecksumSha256: session.expectedChecksumSha256 || null,
          receivedBytes: 0n,
          chunkSizeBytes: session.chunkSizeBytes,
          uploadKey: session.uploadKey,
          status: MEDIA_UPLOAD_STATUS.UPLOADING,
          expiresAt: BigInt(session.expiresAt)
        }
      });
      if (actor) {
        await tx.auditLog.create({
          data: {
            id: randomUUID(),
            organizationId: session.organizationId,
            action: 'MEDIA_UPLOAD_INITIATED',
            resourceType: 'MediaUploadSession',
            resourceId: id,
            details: { actorId: actor.id, category: session.category, expectedSizeBytes: session.expectedSizeBytes },
            ipAddress: actor.ipAddress || null
          }
        });
      }
      return mapPrismaUploadSession(created);
    });
  }

  async findUploadSession(id, organizationId) {
    const row = await this.prisma.mediaUploadSession.findFirst({ where: { id, organizationId } });
    return mapPrismaUploadSession(row);
  }

  async listUploadSessions(organizationId, { status } = {}) {
    const rows = await this.prisma.mediaUploadSession.findMany({
      where: { organizationId, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 100
    });
    return rows.map(mapPrismaUploadSession);
  }

  async updateUploadSessionProgress(id, organizationId, { receivedBytes, status, assetId, errorReason }) {
    const existing = await this.prisma.mediaUploadSession.findFirst({ where: { id, organizationId } });
    if (!existing) return null;
    const updated = await this.prisma.mediaUploadSession.update({
      where: { id },
      data: {
        ...(receivedBytes !== undefined ? { receivedBytes: BigInt(receivedBytes) } : {}),
        ...(status !== undefined ? { status } : {}),
        ...(assetId !== undefined ? { assetId } : {}),
        ...(errorReason !== undefined ? { errorReason } : {})
      }
    });
    return mapPrismaUploadSession(updated);
  }

  async cancelUploadSession(id, organizationId, actor) {
    return await this.prisma.$transaction(async tx => {
      const existing = await tx.mediaUploadSession.findFirst({ where: { id, organizationId } });
      if (!existing) return null;
      if (existing.status === MEDIA_UPLOAD_STATUS.UPLOADED) {
        throw Object.assign(new Error('Completed upload session cannot be cancelled'), { statusCode: 409 });
      }
      const updated = await tx.mediaUploadSession.update({
        where: { id },
        data: { status: MEDIA_UPLOAD_STATUS.CANCELLED }
      });
      if (actor) {
        await tx.auditLog.create({
          data: {
            id: randomUUID(),
            organizationId,
            action: 'MEDIA_UPLOAD_CANCELLED',
            resourceType: 'MediaUploadSession',
            resourceId: id,
            details: { actorId: actor.id, receivedBytes: Number(existing.receivedBytes) },
            ipAddress: actor.ipAddress || null
          }
        });
      }
      return mapPrismaUploadSession(updated);
    });
  }

  async expireAbandonedUploads(nowMs = Date.now()) {
    const expired = await this.prisma.mediaUploadSession.findMany({
      where: { status: 'UPLOADING', expiresAt: { lte: BigInt(nowMs) } }
    });
    if (expired.length) {
      await this.prisma.mediaUploadSession.updateMany({
        where: { status: 'UPLOADING', expiresAt: { lte: BigInt(nowMs) } },
        data: { status: 'EXPIRED' }
      });
    }
    return expired.map(mapPrismaUploadSession);
  }

  async createAsset(asset, actor, { sessionId = null, checkQuota = true } = {}) {
    const id = asset.id || randomUUID();
    return await this.prisma.$transaction(async tx => {
      await ensureOrganization(tx, asset.organizationId);
      if (checkQuota) {
        const storedAgg = await tx.mediaAsset.aggregate({
          where: { organizationId: asset.organizationId },
          _sum: { sizeBytes: true }
        });
        if (Number(storedAgg._sum.sizeBytes ?? 0n) + asset.sizeBytes > env.MEDIA_ORG_QUOTA_BYTES) {
          throw Object.assign(new Error('This media file exceeds the organization media storage quota'), { statusCode: 409 });
        }
      }
      const created = await tx.mediaAsset.create({
        data: {
          id,
          organizationId: asset.organizationId,
          folder: asset.folder || '',
          title: asset.title,
          description: asset.description || '',
          category: asset.category,
          kind: asset.kind || 'VIDEO',
          tags: asset.tags || [],
          channelIds: asset.channelIds || [],
          originalFilename: asset.originalFilename,
          storageKey: asset.storageKey,
          thumbnailKey: asset.thumbnailKey || null,
          previewKey: asset.previewKey || null,
          sizeBytes: BigInt(asset.sizeBytes),
          checksumSha256: asset.checksumSha256,
          mimeType: asset.mimeType || 'application/octet-stream',
          containerFormat: asset.containerFormat || null,
          videoCodec: asset.videoCodec || null,
          audioCodec: asset.audioCodec || null,
          width: asset.width ?? null,
          height: asset.height ?? null,
          frameRate: asset.frameRate ?? null,
          durationSeconds: asset.durationSeconds ?? null,
          bitrateBps: asset.bitrateBps ? BigInt(asset.bitrateBps) : null,
          audioChannels: asset.audioChannels ?? null,
          sampleRateHz: asset.sampleRateHz ?? null,
          hasVideo: Boolean(asset.hasVideo),
          hasAudio: Boolean(asset.hasAudio),
          uploadStatus: asset.uploadStatus || MEDIA_UPLOAD_STATUS.UPLOADED,
          processingStatus: asset.processingStatus || MEDIA_PROCESSING_STATUS.VALIDATING,
          broadcastCompatibility: asset.broadcastCompatibility || MEDIA_BROADCAST_COMPATIBILITY.PENDING,
          compatibilityNotes: asset.compatibilityNotes || [],
          errorReason: asset.errorReason || null,
          createdByUserId: asset.createdByUserId
        }
      });
      if (sessionId) {
        await tx.mediaUploadSession.update({
          where: { id: sessionId },
          data: { status: 'UPLOADED', assetId: id, receivedBytes: BigInt(asset.sizeBytes) }
        });
      }
      await tx.mediaProcessingJob.create({
        data: {
          id: randomUUID(),
          assetId: id,
          organizationId: asset.organizationId,
          jobType: 'VALIDATE_AND_INSPECT',
          status: 'PENDING',
          attempts: 0
        }
      });
      if (actor) {
        await tx.auditLog.create({
          data: {
            id: randomUUID(),
            organizationId: asset.organizationId,
            action: asset.auditAction || 'MEDIA_ASSET_CREATED',
            resourceType: 'MediaAsset',
            resourceId: id,
            details: {
              actorId: actor.id,
              category: asset.category,
              sizeBytes: asset.sizeBytes,
              checksumSha256: asset.checksumSha256
            },
            ipAddress: actor.ipAddress || null
          }
        });
      }
      return mapPrismaMediaAsset(created);
    });
  }

  async updateAssetProcessing(id, organizationId, updates) {
    const existing = await this.prisma.mediaAsset.findFirst({ where: { id, organizationId } });
    if (!existing) return null;
    const updated = await this.prisma.mediaAsset.update({
      where: { id },
      data: {
        kind: updates.kind ?? existing.kind,
        storageKey: updates.storageKey ?? existing.storageKey,
        thumbnailKey: updates.thumbnailKey !== undefined ? updates.thumbnailKey : existing.thumbnailKey,
        previewKey: updates.previewKey !== undefined ? updates.previewKey : existing.previewKey,
        mimeType: updates.mimeType ?? existing.mimeType,
        containerFormat: updates.containerFormat !== undefined ? updates.containerFormat : existing.containerFormat,
        videoCodec: updates.videoCodec !== undefined ? updates.videoCodec : existing.videoCodec,
        audioCodec: updates.audioCodec !== undefined ? updates.audioCodec : existing.audioCodec,
        width: updates.width !== undefined ? updates.width : existing.width,
        height: updates.height !== undefined ? updates.height : existing.height,
        frameRate: updates.frameRate !== undefined ? updates.frameRate : existing.frameRate,
        durationSeconds: updates.durationSeconds !== undefined ? updates.durationSeconds : existing.durationSeconds,
        bitrateBps: updates.bitrateBps !== undefined ? (updates.bitrateBps ? BigInt(updates.bitrateBps) : null) : existing.bitrateBps,
        audioChannels: updates.audioChannels !== undefined ? updates.audioChannels : existing.audioChannels,
        sampleRateHz: updates.sampleRateHz !== undefined ? updates.sampleRateHz : existing.sampleRateHz,
        hasVideo: updates.hasVideo ?? existing.hasVideo,
        hasAudio: updates.hasAudio ?? existing.hasAudio,
        processingStatus: updates.processingStatus ?? existing.processingStatus,
        broadcastCompatibility: updates.broadcastCompatibility ?? existing.broadcastCompatibility,
        compatibilityNotes: updates.compatibilityNotes ?? existing.compatibilityNotes,
        errorReason: updates.errorReason !== undefined ? updates.errorReason : existing.errorReason
      }
    });
    return mapPrismaMediaAsset(updated);
  }

  async updateAssetMetadata(id, organizationId, updates, actor) {
    const existing = await this.prisma.mediaAsset.findFirst({ where: { id, organizationId } });
    if (!existing) return null;
    const updated = await this.prisma.mediaAsset.update({
      where: { id },
      data: {
        title: updates.title ?? existing.title,
        description: updates.description ?? existing.description,
        folder: updates.folder ?? existing.folder,
        category: updates.category ?? existing.category,
        tags: updates.tags ?? existing.tags,
        channelIds: updates.channelIds ?? existing.channelIds
      }
    });
    if (actor) {
      await this.prisma.auditLog.create({
        data: {
          id: randomUUID(),
          organizationId,
          action: 'MEDIA_ASSET_UPDATED',
          resourceType: 'MediaAsset',
          resourceId: id,
          details: { actorId: actor.id, category: updated.category },
          ipAddress: actor.ipAddress || null
        }
      });
    }
    return mapPrismaMediaAsset(updated);
  }

  async inspectAssetReferences(id, organizationId, preloadedAsset = null) {
    const asset = preloadedAsset || mapPrismaMediaAsset(
      await this.prisma.mediaAsset.findFirst({ where: { id, organizationId } })
    );
    if (!asset) return null;
    const reasons = [];
    if (['UPLOADING', 'VALIDATING', 'PROCESSING'].includes(asset.processingStatus)) {
      reasons.push('ACTIVE_PROCESSING_JOB');
    }
    const playlists = await this.prisma.mediaPlaylist.findMany({ where: { organizationId } });
    const referencedPlaylists = playlists
      .filter(p => toJsonArray(p.items).some(item => item.assetId === id || item === id))
      .map(p => ({ id: p.id, name: p.name }));
    if (referencedPlaylists.length) reasons.push('PLAYLIST_REFERENCE');

    const sourcesCount = await this.prisma.videoSource.count({
      where: {
        organizationId,
        OR: [{ mediaAssetId: id }, { fallbackAssetId: id }]
      }
    });
    if (sourcesCount > 0) reasons.push('VIDEO_SOURCE_REFERENCE');

    const audioSourcesCount = await this.prisma.audioSource.count({
      where: {
        organizationId,
        OR: [{ mediaAssetId: id }, { fallbackAssetId: id }]
      }
    });
    if (audioSourcesCount > 0) reasons.push('AUDIO_SOURCE_REFERENCE');

    const playoutConfigs = await this.prisma.channelPlayoutConfig.findMany({ where: { organizationId } });
    for (const cfg of playoutConfigs) {
      const isRunning = ['STARTING', 'RUNNING', 'DEGRADED', 'RECOVERING', 'FALLBACK_ACTIVE'].includes(cfg.runtimeState);
      if (cfg.currentMediaAssetId === id && isRunning) reasons.push('ACTIVE_BROADCAST');
      if (
        cfg.currentMediaAssetId === id ||
        JSON.stringify(cfg.movieQueue || []).includes(id) ||
        JSON.stringify(cfg.fallbackConfig || {}).includes(id) ||
        JSON.stringify(cfg.adSchedulePolicy || {}).includes(id)
      ) {
        reasons.push('CHANNEL_PLAYOUT_REFERENCE');
      }
    }

    const activeRevisions = await this.prisma.channelScheduleRevision.findMany({
      where: {
        organizationId,
        lifecycleState: { in: ['DRAFT', 'VALIDATED', 'PUBLISHED'] }
      }
    });
    for (const rev of activeRevisions) {
      if (rev.gapFallbackAssetId === id || JSON.stringify(rev.events || []).includes(id)) {
        reasons.push('SCHEDULED_PLAYBACK');
      }
    }

    const uniqueReasons = [...new Set(reasons)];
    return {
      usageState: uniqueReasons.includes('ACTIVE_BROADCAST')
        ? 'BROADCASTING'
        : uniqueReasons.length > 0 ? 'REFERENCED' : 'AVAILABLE',
      canDelete: uniqueReasons.length === 0,
      blockingReasons: uniqueReasons,
      playlists: referencedPlaylists,
      counts: { videoSources: sourcesCount, audioSources: audioSourcesCount, playlists: referencedPlaylists.length }
    };
  }

  async findAssetById(id, organizationId) {
    const row = await this.prisma.mediaAsset.findFirst({ where: { id, organizationId } });
    if (!row) return null;
    const mapped = mapPrismaMediaAsset(row);
    const references = await this.inspectAssetReferences(id, organizationId, mapped);
    return { ...mapped, references, eligibleForDeletion: references.canDelete };
  }

  async listAssets(organizationId, {
    page = 1,
    pageSize = 24,
    search = '',
    category = '',
    kind = '',
    folder = '',
    processingStatus = '',
    broadcastCompatibility = '',
    sortBy = 'createdAt',
    sortOrder = 'desc'
  } = {}) {
    const where = {
      organizationId,
      ...(category ? { category } : {}),
      ...(kind ? { kind } : {}),
      ...(folder ? { folder } : {}),
      ...(processingStatus ? { processingStatus } : {}),
      ...(broadcastCompatibility ? { broadcastCompatibility } : {}),
      ...(search ? {
        OR: [
          { title: { contains: search } },
          { description: { contains: search } },
          { originalFilename: { contains: search } }
        ]
      } : {})
    };
    const safePageSize = Math.min(100, Math.max(1, Number(pageSize) || 24));
    const safePage = Math.max(1, Number(page) || 1);
    const allowedSort = ['createdAt', 'updatedAt', 'title', 'sizeBytes', 'durationSeconds'];
    const orderField = allowedSort.includes(sortBy) ? sortBy : 'createdAt';
    const orderDir = String(sortOrder).toLowerCase() === 'asc' ? 'asc' : 'desc';

    const [total, rows] = await Promise.all([
      this.prisma.mediaAsset.count({ where }),
      this.prisma.mediaAsset.findMany({
        where,
        orderBy: { [orderField]: orderDir },
        skip: (safePage - 1) * safePageSize,
        take: safePageSize
      })
    ]);
    const items = [];
    for (const row of rows) {
      const mapped = mapPrismaMediaAsset(row);
      const references = await this.inspectAssetReferences(mapped.id, organizationId, mapped);
      items.push({ ...mapped, references, eligibleForDeletion: references.canDelete });
    }
    return {
      items,
      pagination: {
        page: safePage,
        pageSize: safePageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / safePageSize))
      }
    };
  }

  async listKnownStorageKeys(organizationId) {
    const [assets, sessions] = await Promise.all([
      this.prisma.mediaAsset.findMany({
        where: { organizationId },
        select: { storageKey: true, thumbnailKey: true, previewKey: true }
      }),
      this.prisma.mediaUploadSession.findMany({
        where: { organizationId, status: 'UPLOADING' },
        select: { uploadKey: true }
      })
    ]);
    const keys = [];
    for (const a of assets) {
      if (a.storageKey) keys.push(a.storageKey);
      if (a.thumbnailKey) keys.push(a.thumbnailKey);
      if (a.previewKey) keys.push(a.previewKey);
    }
    for (const s of sessions) {
      if (s.uploadKey) keys.push(s.uploadKey);
    }
    return keys;
  }

  async deleteAsset(id, organizationId, actor) {
    const existing = await this.findAssetById(id, organizationId);
    if (!existing) return null;
    if (!existing.eligibleForDeletion) {
      throw Object.assign(
        new Error(`Media asset cannot be deleted while referenced (${existing.references.blockingReasons.join(', ')})`),
        { statusCode: 409, details: existing.references }
      );
    }
    await this.prisma.$transaction(async tx => {
      await tx.mediaAsset.delete({ where: { id } });
      if (actor) {
        await tx.auditLog.create({
          data: {
            id: randomUUID(),
            organizationId,
            action: 'MEDIA_ASSET_DELETED',
            resourceType: 'MediaAsset',
            resourceId: id,
            details: { actorId: actor.id, title: existing.title, checksumSha256: existing.checksumSha256 },
            ipAddress: actor.ipAddress || null
          }
        });
      }
    });
    return existing;
  }

  async createPlaylist(playlist, actor) {
    const id = playlist.id || randomUUID();
    const created = await this.prisma.mediaPlaylist.create({
      data: {
        id,
        organizationId: playlist.organizationId,
        name: playlist.name,
        description: playlist.description || '',
        kind: playlist.kind,
        channelId: playlist.channelId || null,
        items: playlist.items || [],
        createdByUserId: playlist.createdByUserId
      }
    });
    if (actor) {
      await this.prisma.auditLog.create({
        data: {
          id: randomUUID(),
          organizationId: playlist.organizationId,
          action: 'MEDIA_PLAYLIST_CREATED',
          resourceType: 'MediaPlaylist',
          resourceId: id,
          details: { actorId: actor.id, kind: playlist.kind },
          ipAddress: actor.ipAddress || null
        }
      });
    }
    return {
      ...created,
      items: toJsonArray(created.items),
      createdAt: created.createdAt.toISOString(),
      updatedAt: created.updatedAt.toISOString()
    };
  }

  async listPlaylists(organizationId, { kind = '' } = {}) {
    const rows = await this.prisma.mediaPlaylist.findMany({
      where: { organizationId, ...(kind ? { kind } : {}) },
      orderBy: { createdAt: 'desc' }
    });
    return rows.map(r => ({
      ...r,
      items: toJsonArray(r.items),
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString()
    }));
  }

  async deletePlaylist(id, organizationId, actor) {
    const existing = await this.prisma.mediaPlaylist.findFirst({ where: { id, organizationId } });
    if (!existing) return null;
    await this.prisma.mediaPlaylist.delete({ where: { id } });
    if (actor) {
      await this.prisma.auditLog.create({
        data: {
          id: randomUUID(),
          organizationId,
          action: 'MEDIA_PLAYLIST_DELETED',
          resourceType: 'MediaPlaylist',
          resourceId: id,
          details: { actorId: actor.id, name: existing.name },
          ipAddress: actor.ipAddress || null
        }
      });
    }
    return existing;
  }
}

export class PrismaVideoSourceRepository extends IVideoSourceRepository {
  constructor(prisma = getPrismaClient()) {
    super();
    this.prisma = prisma;
  }

  async createSource(source, actor) {
    const id = source.id || randomUUID();
    return await this.prisma.$transaction(async tx => {
      await ensureOrganization(tx, source.organizationId);
      const created = await tx.videoSource.create({
        data: {
          id,
          organizationId: source.organizationId,
          stationId: source.stationId || null,
          name: source.name,
          description: source.description || '',
          sourceType: source.sourceType,
          mediaAssetId: source.mediaAssetId || null,
          playlistId: source.playlistId || null,
          streamUrl: source.streamUrl || null,
          encryptedSecret: source.encryptedSecret || null,
          serverFilePath: source.serverFilePath || null,
          connectionStatus: source.connectionStatus || VIDEO_SOURCE_CONNECTION_STATUS.OFFLINE,
          availabilityStatus: source.availabilityStatus || VIDEO_SOURCE_AVAILABILITY.UNAVAILABLE,
          width: source.width ?? null,
          height: source.height ?? null,
          frameRate: source.frameRate ?? null,
          videoCodec: source.videoCodec || null,
          audioCodec: source.audioCodec || null,
          hasAudio: Boolean(source.hasAudio),
          previewThumbnailKey: source.previewThumbnailKey || null,
          reconnectEnabled: source.reconnectEnabled !== undefined ? Boolean(source.reconnectEnabled) : true,
          maxRetries: source.maxRetries ?? 5,
          retryCount: 0,
          backoffBaseMs: source.backoffBaseMs ?? 2000,
          backoffMaxMs: source.backoffMaxMs ?? 30000,
          fallbackSourceId: source.fallbackSourceId || null,
          fallbackAssetId: source.fallbackAssetId || null,
          fallbackMode: source.fallbackMode || 'SLATE',
          createdByUserId: source.createdByUserId
        }
      });
      if (actor) {
        await tx.auditLog.create({
          data: {
            id: randomUUID(),
            organizationId: source.organizationId,
            action: 'VIDEO_SOURCE_CREATED',
            resourceType: 'VideoSource',
            resourceId: id,
            details: { actorId: actor.id, sourceType: source.sourceType, name: source.name },
            ipAddress: actor.ipAddress || null
          }
        });
      }
      return mapPrismaVideoSource(created);
    });
  }

  async updateSource(id, organizationId, updates, actor) {
    const existing = await this.prisma.videoSource.findFirst({ where: { id, organizationId } });
    if (!existing) return null;
    const updated = await this.prisma.videoSource.update({
      where: { id },
      data: {
        name: updates.name ?? existing.name,
        description: updates.description ?? existing.description,
        stationId: updates.stationId !== undefined ? updates.stationId : existing.stationId,
        streamUrl: updates.streamUrl !== undefined ? updates.streamUrl : existing.streamUrl,
        encryptedSecret: updates.encryptedSecret !== undefined ? updates.encryptedSecret : existing.encryptedSecret,
        mediaAssetId: updates.mediaAssetId !== undefined ? updates.mediaAssetId : existing.mediaAssetId,
        playlistId: updates.playlistId !== undefined ? updates.playlistId : existing.playlistId,
        reconnectEnabled: updates.reconnectEnabled !== undefined ? Boolean(updates.reconnectEnabled) : existing.reconnectEnabled,
        maxRetries: updates.maxRetries ?? existing.maxRetries,
        backoffBaseMs: updates.backoffBaseMs ?? existing.backoffBaseMs,
        backoffMaxMs: updates.backoffMaxMs ?? existing.backoffMaxMs,
        fallbackSourceId: updates.fallbackSourceId !== undefined ? updates.fallbackSourceId : existing.fallbackSourceId,
        fallbackAssetId: updates.fallbackAssetId !== undefined ? updates.fallbackAssetId : existing.fallbackAssetId,
        fallbackMode: updates.fallbackMode ?? existing.fallbackMode
      }
    });
    if (actor) {
      await this.prisma.auditLog.create({
        data: {
          id: randomUUID(),
          organizationId,
          action: 'VIDEO_SOURCE_UPDATED',
          resourceType: 'VideoSource',
          resourceId: id,
          details: { actorId: actor.id, name: updated.name },
          ipAddress: actor.ipAddress || null
        }
      });
    }
    return mapPrismaVideoSource(updated);
  }

  async updateSourceProbeState(id, organizationId, probe) {
    const existing = await this.prisma.videoSource.findFirst({ where: { id, organizationId } });
    if (!existing) return null;
    const updated = await this.prisma.videoSource.update({
      where: { id },
      data: {
        connectionStatus: probe.connectionStatus ?? existing.connectionStatus,
        availabilityStatus: probe.availabilityStatus ?? existing.availabilityStatus,
        width: probe.width !== undefined ? probe.width : existing.width,
        height: probe.height !== undefined ? probe.height : existing.height,
        frameRate: probe.frameRate !== undefined ? probe.frameRate : existing.frameRate,
        videoCodec: probe.videoCodec !== undefined ? probe.videoCodec : existing.videoCodec,
        audioCodec: probe.audioCodec !== undefined ? probe.audioCodec : existing.audioCodec,
        hasAudio: probe.hasAudio !== undefined ? Boolean(probe.hasAudio) : existing.hasAudio,
        previewThumbnailKey: probe.previewThumbnailKey !== undefined ? probe.previewThumbnailKey : existing.previewThumbnailKey,
        lastConnectedAt: probe.lastConnectedAt !== undefined ? (probe.lastConnectedAt ? new Date(probe.lastConnectedAt) : null) : existing.lastConnectedAt,
        lastProbedAt: new Date(),
        lastError: probe.lastError !== undefined ? probe.lastError : existing.lastError,
        retryCount: probe.retryCount !== undefined ? probe.retryCount : existing.retryCount
      }
    });
    return mapPrismaVideoSource(updated);
  }

  async findSourceById(id, organizationId, { includeEncryptedSecret = false } = {}) {
    const row = await this.prisma.videoSource.findFirst({ where: { id, organizationId } });
    if (!row) return null;
    const mapped = mapPrismaVideoSource(row);
    if (includeEncryptedSecret) mapped.encryptedSecret = row.encryptedSecret;
    return mapped;
  }

  async listSources(organizationId, { sourceType = '', stationId = '', availabilityStatus = '', search = '' } = {}) {
    const rows = await this.prisma.videoSource.findMany({
      where: {
        organizationId,
        ...(sourceType ? { sourceType } : {}),
        ...(stationId ? { stationId } : {}),
        ...(availabilityStatus ? { availabilityStatus } : {}),
        ...(search ? { name: { contains: search } } : {})
      },
      orderBy: { createdAt: 'desc' }
    });
    return rows.map(mapPrismaVideoSource);
  }

  async deleteSource(id, organizationId, actor) {
    const existing = await this.prisma.videoSource.findFirst({ where: { id, organizationId } });
    if (!existing) return null;
    const fallbackUsers = await this.prisma.videoSource.count({
      where: { organizationId, fallbackSourceId: id }
    });
    if (fallbackUsers > 0) {
      throw Object.assign(new Error('Cannot delete a video source while it is configured as a fallback for another source'), { statusCode: 409 });
    }
    await this.prisma.$transaction(async tx => {
      await tx.videoSource.delete({ where: { id } });
      if (actor) {
        await tx.auditLog.create({
          data: {
            id: randomUUID(),
            organizationId,
            action: 'VIDEO_SOURCE_DELETED',
            resourceType: 'VideoSource',
            resourceId: id,
            details: { actorId: actor.id, name: existing.name, sourceType: existing.sourceType },
            ipAddress: actor.ipAddress || null
          }
        });
      }
    });
    return mapPrismaVideoSource(existing);
  }
}

export class PrismaAudioRepository extends IAudioRepository {
  constructor(prisma = getPrismaClient()) {
    super();
    this.prisma = prisma;
  }

  async createAudioSource(source, actor) {
    const id = source.id || randomUUID();
    const enabled = source.enabled !== undefined ? Boolean(source.enabled) : true;
    const state = !enabled
      ? AUDIO_SOURCE_STATES.DISABLED
      : source.state || (source.sourceType === 'MICROPHONE_INPUT' ? AUDIO_SOURCE_STATES.PAUSED : AUDIO_SOURCE_STATES.ONLINE);

    return await this.prisma.$transaction(async tx => {
      await ensureOrganization(tx, source.organizationId);
      const created = await tx.audioSource.create({
        data: {
          id,
          organizationId: source.organizationId,
          channelId: source.channelId,
          name: source.name,
          description: source.description || '',
          sourceType: source.sourceType,
          mediaAssetId: source.mediaAssetId || null,
          playlistId: source.playlistId || null,
          videoSourceId: source.videoSourceId || null,
          obsInputName: source.obsInputName || null,
          streamUrl: source.streamUrl || null,
          encryptedSecret: source.encryptedSecret || null,
          enabled,
          muted: Boolean(source.muted),
          soloMonitoring: Boolean(source.soloMonitoring),
          volumeLinear: source.volumeLinear ?? 1.0,
          gainDb: source.gainDb ?? 0.0,
          delayMs: source.delayMs ?? 0,
          fadeInMs: source.fadeInMs ?? 500,
          fadeOutMs: source.fadeOutMs ?? 500,
          priority: source.priority ?? 50,
          duckingTrigger: Boolean(source.duckingTrigger),
          duckingTarget: source.duckingTarget !== undefined ? Boolean(source.duckingTarget) : true,
          repeatMode: source.repeatMode || 'REPEAT_PLAYLIST',
          shuffleEnabled: Boolean(source.shuffleEnabled),
          crossfadeMs: source.crossfadeMs ?? 1500,
          currentTrackIndex: source.currentTrackIndex ?? 0,
          currentTrackAssetId: source.currentTrackAssetId || null,
          playbackPositionMs: source.playbackPositionMs ?? 0,
          remainingDurationMs: source.remainingDurationMs ?? null,
          state,
          measuredRmsDbfs: source.measuredRmsDbfs ?? -90.0,
          measuredPeakDbfs: source.measuredPeakDbfs ?? -90.0,
          clippingDetected: Boolean(source.clippingDetected),
          codec: source.codec || 'aac',
          sampleRateHz: source.sampleRateHz ?? 48000,
          channels: source.channels ?? 2,
          streamMetadata: source.streamMetadata || null,
          reconnectEnabled: source.reconnectEnabled !== undefined ? Boolean(source.reconnectEnabled) : true,
          maxRetries: source.maxRetries ?? 5,
          retryCount: 0,
          backoffBaseMs: source.backoffBaseMs ?? 2000,
          backoffMaxMs: source.backoffMaxMs ?? 30000,
          fallbackSourceId: source.fallbackSourceId || null,
          fallbackAssetId: source.fallbackAssetId || null,
          lastConnectedAt: source.lastConnectedAt ? new Date(source.lastConnectedAt) : null,
          lastError: source.lastError || null,
          createdByUserId: source.createdByUserId
        }
      });
      if (actor) {
        await tx.auditLog.create({
          data: {
            id: randomUUID(),
            organizationId: source.organizationId,
            action: 'AUDIO_SOURCE_CREATED',
            resourceType: 'AudioSource',
            resourceId: id,
            details: { actorId: actor.id, channelId: source.channelId, sourceType: source.sourceType, name: source.name },
            ipAddress: actor.ipAddress || null
          }
        });
      }
      return mapAudioSourceRow(created);
    });
  }

  async updateAudioSource(id, organizationId, updates, actor) {
    const existing = await this.prisma.audioSource.findFirst({ where: { id, organizationId } });
    if (!existing) return null;
    const enabled = updates.enabled !== undefined ? Boolean(updates.enabled) : Boolean(existing.enabled);
    const nextState = !enabled
      ? AUDIO_SOURCE_STATES.DISABLED
      : (updates.state ?? (existing.state === AUDIO_SOURCE_STATES.DISABLED ? AUDIO_SOURCE_STATES.ONLINE : existing.state));

    const updated = await this.prisma.audioSource.update({
      where: { id },
      data: {
        name: updates.name ?? existing.name,
        description: updates.description ?? existing.description,
        streamUrl: updates.streamUrl !== undefined ? updates.streamUrl : existing.streamUrl,
        encryptedSecret: updates.encryptedSecret !== undefined ? updates.encryptedSecret : existing.encryptedSecret,
        mediaAssetId: updates.mediaAssetId !== undefined ? updates.mediaAssetId : existing.mediaAssetId,
        playlistId: updates.playlistId !== undefined ? updates.playlistId : existing.playlistId,
        videoSourceId: updates.videoSourceId !== undefined ? updates.videoSourceId : existing.videoSourceId,
        obsInputName: updates.obsInputName !== undefined ? updates.obsInputName : existing.obsInputName,
        enabled,
        muted: updates.muted !== undefined ? Boolean(updates.muted) : existing.muted,
        soloMonitoring: updates.soloMonitoring !== undefined ? Boolean(updates.soloMonitoring) : existing.soloMonitoring,
        volumeLinear: updates.volumeLinear ?? existing.volumeLinear,
        gainDb: updates.gainDb ?? existing.gainDb,
        delayMs: updates.delayMs ?? existing.delayMs,
        fadeInMs: updates.fadeInMs ?? existing.fadeInMs,
        fadeOutMs: updates.fadeOutMs ?? existing.fadeOutMs,
        priority: updates.priority ?? existing.priority,
        duckingTrigger: updates.duckingTrigger !== undefined ? Boolean(updates.duckingTrigger) : existing.duckingTrigger,
        duckingTarget: updates.duckingTarget !== undefined ? Boolean(updates.duckingTarget) : existing.duckingTarget,
        repeatMode: updates.repeatMode ?? existing.repeatMode,
        shuffleEnabled: updates.shuffleEnabled !== undefined ? Boolean(updates.shuffleEnabled) : existing.shuffleEnabled,
        crossfadeMs: updates.crossfadeMs ?? existing.crossfadeMs,
        state: nextState,
        reconnectEnabled: updates.reconnectEnabled !== undefined ? Boolean(updates.reconnectEnabled) : existing.reconnectEnabled,
        maxRetries: updates.maxRetries ?? existing.maxRetries,
        backoffBaseMs: updates.backoffBaseMs ?? existing.backoffBaseMs,
        backoffMaxMs: updates.backoffMaxMs ?? existing.backoffMaxMs,
        fallbackSourceId: updates.fallbackSourceId !== undefined ? updates.fallbackSourceId : existing.fallbackSourceId,
        fallbackAssetId: updates.fallbackAssetId !== undefined ? updates.fallbackAssetId : existing.fallbackAssetId
      }
    });
    if (actor) {
      await this.prisma.auditLog.create({
        data: {
          id: randomUUID(),
          organizationId,
          action: 'AUDIO_SOURCE_UPDATED',
          resourceType: 'AudioSource',
          resourceId: id,
          details: { actorId: actor.id, channelId: existing.channelId, updatedFields: Object.keys(updates) },
          ipAddress: actor.ipAddress || null
        }
      });
    }
    return mapAudioSourceRow(updated);
  }

  async updateAudioSourceRuntimeState(id, organizationId, runtime) {
    const existing = await this.prisma.audioSource.findFirst({ where: { id, organizationId } });
    if (!existing) return null;
    const updated = await this.prisma.audioSource.update({
      where: { id },
      data: {
        state: runtime.state ?? existing.state,
        measuredRmsDbfs: runtime.measuredRmsDbfs ?? existing.measuredRmsDbfs,
        measuredPeakDbfs: runtime.measuredPeakDbfs ?? existing.measuredPeakDbfs,
        clippingDetected: runtime.clippingDetected !== undefined ? Boolean(runtime.clippingDetected) : existing.clippingDetected,
        currentTrackIndex: runtime.currentTrackIndex ?? existing.currentTrackIndex,
        currentTrackAssetId: runtime.currentTrackAssetId !== undefined ? runtime.currentTrackAssetId : existing.currentTrackAssetId,
        playbackPositionMs: runtime.playbackPositionMs ?? existing.playbackPositionMs,
        remainingDurationMs: runtime.remainingDurationMs !== undefined ? runtime.remainingDurationMs : existing.remainingDurationMs,
        codec: runtime.codec !== undefined ? runtime.codec : existing.codec,
        sampleRateHz: runtime.sampleRateHz ?? existing.sampleRateHz,
        channels: runtime.channels ?? existing.channels,
        streamMetadata: runtime.streamMetadata !== undefined ? runtime.streamMetadata : existing.streamMetadata,
        retryCount: runtime.retryCount ?? existing.retryCount,
        lastConnectedAt: runtime.lastConnectedAt !== undefined
          ? (runtime.lastConnectedAt ? new Date(runtime.lastConnectedAt) : null)
          : existing.lastConnectedAt,
        lastError: runtime.lastError !== undefined ? runtime.lastError : existing.lastError
      }
    });
    return mapAudioSourceRow(updated);
  }

  async findAudioSourceById(id, organizationId, options = {}) {
    const row = await this.prisma.audioSource.findFirst({ where: { id, organizationId } });
    return mapAudioSourceRow(row, options);
  }

  async listAudioSources(organizationId, { channelId = '', sourceType = '', state = '' } = {}) {
    const rows = await this.prisma.audioSource.findMany({
      where: {
        organizationId,
        ...(channelId ? { channelId } : {}),
        ...(sourceType ? { sourceType } : {}),
        ...(state ? { state } : {})
      },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }]
    });
    return rows.map(r => mapAudioSourceRow(r));
  }

  async deleteAudioSource(id, organizationId, actor) {
    const existing = await this.prisma.audioSource.findFirst({ where: { id, organizationId } });
    if (!existing) return null;
    const [sourceFb, mixerFb] = await Promise.all([
      this.prisma.audioSource.count({ where: { organizationId, fallbackSourceId: id } }),
      this.prisma.audioMixerConfig.count({ where: { organizationId, fallbackSourceId: id } })
    ]);
    if (sourceFb > 0 || mixerFb > 0) {
      throw Object.assign(
        new Error('Cannot delete an audio source while it is configured as a fallback audio source'),
        { statusCode: 409 }
      );
    }
    await this.prisma.$transaction(async tx => {
      await tx.audioSource.delete({ where: { id } });
      if (actor) {
        await tx.auditLog.create({
          data: {
            id: randomUUID(),
            organizationId,
            action: 'AUDIO_SOURCE_DELETED',
            resourceType: 'AudioSource',
            resourceId: id,
            details: { actorId: actor.id, channelId: existing.channelId, name: existing.name },
            ipAddress: actor.ipAddress || null
          }
        });
      }
    });
    return mapAudioSourceRow(existing);
  }

  async getChannelMixerConfig(channelId, organizationId) {
    const row = await this.prisma.audioMixerConfig.findUnique({
      where: { channelId_organizationId: { channelId, organizationId } }
    });
    return row ? mapMixerConfigRow(row) : defaultChannelMixerConfig(channelId, organizationId);
  }

  async saveChannelMixerConfig(channelId, organizationId, updates, actor) {
    const current = await this.getChannelMixerConfig(channelId, organizationId);
    const merged = {
      ...current,
      ...updates,
      channelId,
      organizationId,
      updatedByUserId: actor?.id || current.updatedByUserId
    };
    const { updatedAt, ...dataFields } = merged;
    const saved = await this.prisma.$transaction(async tx => {
      await ensureOrganization(tx, organizationId);
      const upserted = await tx.audioMixerConfig.upsert({
        where: { channelId_organizationId: { channelId, organizationId } },
        update: dataFields,
        create: dataFields
      });
      if (actor) {
        await tx.auditLog.create({
          data: {
            id: randomUUID(),
            organizationId,
            action: 'AUDIO_MIXER_CONFIG_UPDATED',
            resourceType: 'AudioMixerConfig',
            resourceId: channelId,
            details: { actorId: actor.id, channelId, routingMode: merged.routingMode },
            ipAddress: actor.ipAddress || null
          }
        });
      }
      return upserted;
    });
    return mapMixerConfigRow(saved);
  }
}


export class PrismaChannelPlayoutRepository extends IChannelPlayoutRepository {
  constructor(prisma = getPrismaClient()) {
    super();
    this.prisma = prisma;
  }

  async getChannelConfig(channelId, organizationId) {
    const row = await this.prisma.channelPlayoutConfig.findUnique({
      where: { channelId_organizationId: { channelId, organizationId } }
    });
    return row ? mapChannelPlayoutConfigRow(row) : defaultChannelPlayoutConfig(channelId, organizationId);
  }

  async listChannelConfigs(organizationId) {
    const rows = await this.prisma.channelPlayoutConfig.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'asc' }
    });
    return rows.map(mapChannelPlayoutConfigRow);
  }

  async saveChannelConfig(channelId, organizationId, updates, actor) {
    const existingRow = await this.prisma.channelPlayoutConfig.findUnique({
      where: { channelId_organizationId: { channelId, organizationId } }
    });
    const current = existingRow ? mapChannelPlayoutConfigRow(existingRow) : defaultChannelPlayoutConfig(channelId, organizationId);

    if (updates.expectedRevision !== undefined && existingRow && Number(updates.expectedRevision) !== current.revision) {
      throw Object.assign(new Error('Channel playout configuration was modified by another session (revision mismatch)'), {
        statusCode: 409
      });
    }

    const nextRevision = existingRow ? current.revision + 1 : 1;
    const merged = {
      ...current,
      ...updates,
      channelId,
      organizationId,
      revision: nextRevision,
      updatedByUserId: actor?.id || current.updatedByUserId
    };
    const { createdAt, updatedAt, expectedRevision, ...dataFields } = merged;
    if (dataFields.lastHeartbeatAt) dataFields.lastHeartbeatAt = new Date(dataFields.lastHeartbeatAt);
    if (dataFields.lastOutputAt) dataFields.lastOutputAt = new Date(dataFields.lastOutputAt);
    if (dataFields.lastRecoveryAt) dataFields.lastRecoveryAt = new Date(dataFields.lastRecoveryAt);

    const saved = await this.prisma.$transaction(async tx => {
      await ensureOrganization(tx, organizationId);
      const upserted = await tx.channelPlayoutConfig.upsert({
        where: { channelId_organizationId: { channelId, organizationId } },
        update: dataFields,
        create: dataFields
      });
      if (actor) {
        await tx.auditLog.create({
          data: {
            id: randomUUID(),
            organizationId,
            action: actor.auditAction || 'CHANNEL_PLAYOUT_CONFIG_UPDATED',
            resourceType: 'ChannelPlayoutConfig',
            resourceId: channelId,
            details: {
              actorId: actor.id,
              channelId,
              playoutMode: merged.playoutMode,
              desiredState: merged.desiredState,
              runtimeState: merged.runtimeState,
              revision: merged.revision
            },
            ipAddress: actor.ipAddress || null
          }
        });
      }
      return upserted;
    });
    return mapChannelPlayoutConfigRow(saved);
  }

  async updateRuntimeCheckpoint(channelId, organizationId, checkpoint) {
    const current = await this.getChannelConfig(channelId, organizationId);
    const merged = {
      ...current,
      ...checkpoint,
      channelId,
      organizationId
    };
    const { createdAt, updatedAt, expectedRevision, ...dataFields } = merged;
    if (dataFields.lastHeartbeatAt) dataFields.lastHeartbeatAt = new Date(dataFields.lastHeartbeatAt);
    if (dataFields.lastOutputAt) dataFields.lastOutputAt = new Date(dataFields.lastOutputAt);
    if (dataFields.lastRecoveryAt) dataFields.lastRecoveryAt = new Date(dataFields.lastRecoveryAt);

    const saved = await this.prisma.$transaction(async tx => {
      await ensureOrganization(tx, organizationId);
      return await tx.channelPlayoutConfig.upsert({
        where: { channelId_organizationId: { channelId, organizationId } },
        update: dataFields,
        create: dataFields
      });
    });
    return mapChannelPlayoutConfigRow(saved);
  }
}


export class PrismaBroadcastSchedulerRepository extends IBroadcastSchedulerRepository {
  constructor(prisma = getPrismaClient()) {
    super();
    this.prisma = prisma;
  }

  async getOrCreateDraftRevision(channelId, organizationId, actor) {
    const existingDraft = await this.prisma.channelScheduleRevision.findFirst({
      where: {
        organizationId,
        channelId,
        lifecycleState: { in: ['DRAFT', 'VALIDATED'] }
      },
      orderBy: { revisionNumber: 'desc' }
    });
    if (existingDraft) return mapScheduleRevisionRow(existingDraft);

    const activePub = await this.prisma.channelScheduleRevision.findFirst({
      where: { organizationId, channelId, lifecycleState: 'PUBLISHED' },
      orderBy: { revisionNumber: 'desc' }
    });

    const agg = await this.prisma.channelScheduleRevision.aggregate({
      where: { organizationId, channelId },
      _max: { revisionNumber: true }
    });
    const nextRev = Number(agg._max?.revisionNumber ?? 0) + 1;

    const created = await this.prisma.channelScheduleRevision.create({
      data: {
        id: randomUUID(),
        organizationId,
        channelId,
        revisionNumber: nextRev,
        name: activePub?.name || 'Broadcast Schedule',
        timezone: activePub?.timezone || 'UTC',
        lifecycleState: 'DRAFT',
        activationPolicy: activePub?.activationPolicy || 'APPLY_NEXT_BOUNDARY',
        gapPolicy: activePub?.gapPolicy || 'FALLBACK_PLAYLIST',
        gapFallbackAssetId: activePub?.gapFallbackAssetId || null,
        gapFallbackSourceId: activePub?.gapFallbackSourceId || null,
        gapFallbackPlaylistId: activePub?.gapFallbackPlaylistId || null,
        events: activePub?.events || [],
        templates: activePub?.templates || [],
        validationSummary: {},
        createdByUserId: actor?.id || 'system'
      }
    });
    return mapScheduleRevisionRow(created);
  }

  async saveDraftRevision(channelId, organizationId, draftPayload, actor) {
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

    const nextEvents = draftPayload.events !== undefined ? draftPayload.events : currentDraft.events;
    const nextTemplates = draftPayload.templates !== undefined ? draftPayload.templates : currentDraft.templates;

    const updated = await this.prisma.$transaction(async tx => {
      await ensureOrganization(tx, organizationId);
      const row = await tx.channelScheduleRevision.update({
        where: { id: currentDraft.id },
        data: {
          name: draftPayload.name ?? currentDraft.name,
          timezone: draftPayload.timezone ?? currentDraft.timezone,
          lifecycleState: 'DRAFT',
          activationPolicy: draftPayload.activationPolicy ?? currentDraft.activationPolicy,
          effectiveFromUtc: draftPayload.effectiveFromUtc !== undefined
            ? (draftPayload.effectiveFromUtc ? new Date(draftPayload.effectiveFromUtc) : null)
            : (currentDraft.effectiveFromUtc ? new Date(currentDraft.effectiveFromUtc) : null),
          gapPolicy: draftPayload.gapPolicy ?? currentDraft.gapPolicy,
          gapFallbackAssetId: draftPayload.gapFallbackAssetId !== undefined ? draftPayload.gapFallbackAssetId : currentDraft.gapFallbackAssetId,
          gapFallbackSourceId: draftPayload.gapFallbackSourceId !== undefined ? draftPayload.gapFallbackSourceId : currentDraft.gapFallbackSourceId,
          gapFallbackPlaylistId: draftPayload.gapFallbackPlaylistId !== undefined ? draftPayload.gapFallbackPlaylistId : currentDraft.gapFallbackPlaylistId,
          events: nextEvents,
          templates: nextTemplates,
          validationSummary: {}
        }
      });
      if (actor) {
        await tx.auditLog.create({
          data: {
            id: randomUUID(),
            organizationId,
            action: 'SCHEDULE_DRAFT_SAVED',
            resourceType: 'ChannelScheduleRevision',
            resourceId: currentDraft.id,
            details: { actorId: actor.id, channelId, revisionNumber: currentDraft.revisionNumber, eventCount: nextEvents.length },
            ipAddress: actor.ipAddress || null
          }
        });
      }
      return row;
    });
    return mapScheduleRevisionRow(updated);
  }

  async markRevisionValidated(revisionId, organizationId, validationSummary) {
    const existing = await this.getRevisionById(revisionId, organizationId);
    if (!existing) return null;
    if (!['DRAFT', 'VALIDATED'].includes(existing.lifecycleState)) {
      throw Object.assign(new Error('Only DRAFT or VALIDATED revisions can be validated'), { statusCode: 409 });
    }
    const nextState = validationSummary.valid ? SCHEDULE_LIFECYCLE_STATES.VALIDATED : SCHEDULE_LIFECYCLE_STATES.DRAFT;
    const updated = await this.prisma.channelScheduleRevision.update({
      where: { id: revisionId },
      data: {
        lifecycleState: nextState,
        validationSummary
      }
    });
    return mapScheduleRevisionRow(updated);
  }

  async publishRevision(channelId, organizationId, {
    revisionId,
    expectedRevisionNumber,
    activationPolicy,
    effectiveFromUtc = null,
    validationSummary
  }, actor) {
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

    const finalPolicy = activationPolicy || target.activationPolicy || 'APPLY_NEXT_BOUNDARY';
    const finalEffective = effectiveFromUtc !== undefined ? effectiveFromUtc : target.effectiveFromUtc;
    const isFutureActivation = finalPolicy === 'APPLY_FUTURE_TIME' && finalEffective && Date.parse(finalEffective) > Date.now();

    const published = await this.prisma.$transaction(async tx => {
      await ensureOrganization(tx, organizationId);
      if (!isFutureActivation) {
        await tx.channelScheduleRevision.updateMany({
          where: {
            organizationId,
            channelId,
            lifecycleState: 'PUBLISHED',
            id: { not: target.id }
          },
          data: { lifecycleState: 'SUPERSEDED' }
        });
      }
      const row = await tx.channelScheduleRevision.update({
        where: { id: target.id },
        data: {
          lifecycleState: 'PUBLISHED',
          activationPolicy: finalPolicy,
          effectiveFromUtc: finalEffective ? new Date(finalEffective) : null,
          validationSummary: validationSummary || target.validationSummary || { valid: true },
          publishedByUserId: actor?.id || 'system',
          publishedAt: new Date()
        }
      });
      if (actor) {
        await tx.auditLog.create({
          data: {
            id: randomUUID(),
            organizationId,
            action: 'SCHEDULE_REVISION_PUBLISHED',
            resourceType: 'ChannelScheduleRevision',
            resourceId: target.id,
            details: {
              actorId: actor.id,
              channelId,
              revisionNumber: target.revisionNumber,
              activationPolicy: finalPolicy
            },
            ipAddress: actor.ipAddress || null
          }
        });
      }
      return row;
    });
    return mapScheduleRevisionRow(published);
  }

  async getActivePublishedRevision(channelId, organizationId) {
    const row = await this.prisma.channelScheduleRevision.findFirst({
      where: { organizationId, channelId, lifecycleState: 'PUBLISHED' },
      orderBy: { revisionNumber: 'desc' }
    });
    return mapScheduleRevisionRow(row);
  }

  async getRevisionById(revisionId, organizationId) {
    const row = await this.prisma.channelScheduleRevision.findFirst({
      where: { id: revisionId, organizationId }
    });
    return mapScheduleRevisionRow(row);
  }

  async listRevisions(channelId, organizationId) {
    const rows = await this.prisma.channelScheduleRevision.findMany({
      where: { organizationId, channelId },
      orderBy: { revisionNumber: 'desc' },
      take: 50
    });
    return rows.map(mapScheduleRevisionRow);
  }

  async getExecutionState(channelId, organizationId) {
    const row = await this.prisma.channelSchedulerExecutionState.findUnique({
      where: { channelId_organizationId: { channelId, organizationId } }
    });
    return row ? mapSchedulerExecutionStateRow(row) : defaultSchedulerExecutionState(channelId, organizationId);
  }

  async acquireSchedulerLease(channelId, organizationId, ownerId, nowMs, ttlMs = 5000) {
    return await this.prisma.$transaction(async tx => {
      await ensureOrganization(tx, organizationId);
      const row = await tx.channelSchedulerExecutionState.findUnique({
        where: { channelId_organizationId: { channelId, organizationId } }
      });
      if (!row) {
        try {
          await tx.channelSchedulerExecutionState.create({
            data: {
              ...defaultSchedulerExecutionState(channelId, organizationId),
              updatedAt: undefined,
              leaseOwnerId: ownerId,
              leaseExpiresAt: BigInt(nowMs + ttlMs)
            }
          });
          return { acquired: true, tookOverFrom: null };
        } catch {
          return { acquired: false, tookOverFrom: null };
        }
      }
      const result = await tx.channelSchedulerExecutionState.updateMany({
        where: {
          channelId,
          organizationId,
          OR: [{ leaseOwnerId: ownerId }, { leaseOwnerId: null }, { leaseExpiresAt: { lte: BigInt(nowMs) } }]
        },
        data: { leaseOwnerId: ownerId, leaseExpiresAt: BigInt(nowMs + ttlMs) }
      });
      const tookOverFrom = result.count === 1 && row.leaseOwnerId && row.leaseOwnerId !== ownerId ? row.leaseOwnerId : null;
      return { acquired: result.count === 1, tookOverFrom };
    });
  }

  async releaseSchedulerLease(channelId, organizationId, ownerId) {
    await this.prisma.channelSchedulerExecutionState.updateMany({
      where: { channelId, organizationId, leaseOwnerId: ownerId },
      data: { leaseOwnerId: null, leaseExpiresAt: BigInt(0) }
    });
  }

  async claimOccurrence(record, { ownerId = null } = {}) {
    return await this.prisma.$transaction(async tx => {
      if (ownerId) {
        const state = await tx.channelSchedulerExecutionState.findUnique({
          where: { channelId_organizationId: { channelId: record.channelId, organizationId: record.organizationId } }
        });
        if (!state || state.leaseOwnerId !== ownerId) return { claimed: false, ownerLost: true, record: null };
      }
      const existing = await tx.channelAsRunLog.findUnique({ where: { occurrenceId: record.occurrenceId } });
      if (existing) return { claimed: false, ownerLost: false, record: mapAsRunLogRow(existing) };
      const row = await tx.channelAsRunLog.create({
        data: {
          id: record.id || randomUUID(),
          organizationId: record.organizationId,
          channelId: record.channelId,
          revisionId: record.revisionId || null,
          revisionNumber: record.revisionNumber ?? 0,
          eventId: record.eventId,
          occurrenceId: record.occurrenceId,
          trackType: record.trackType,
          executionMode: record.executionMode,
          title: record.title,
          category: record.category || 'PROGRAM',
          mediaAssetId: record.mediaAssetId || null,
          videoSourceId: record.videoSourceId || null,
          audioSourceId: record.audioSourceId || null,
          plannedStartUtc: new Date(record.plannedStartUtc),
          actualStartUtc: new Date(record.actualStartUtc || new Date()),
          plannedEndUtc: new Date(record.plannedEndUtc),
          actualEndUtc: null,
          plannedDurationMs: Number(record.plannedDurationMs),
          actualDurationMs: null,
          status: 'CLAIMED',
          interruptionReason: null,
          resumeOffsetMs: Number(record.resumeOffsetMs ?? 0),
          workerConfirmed: false,
          details: record.details || {}
        }
      });
      return { claimed: true, ownerLost: false, record: mapAsRunLogRow(row) };
    });
  }

  async updateExecutionState(channelId, organizationId, updates, { ownerId = null } = {}) {
    if (ownerId) {
      const state = await this.prisma.channelSchedulerExecutionState.findUnique({
        where: { channelId_organizationId: { channelId, organizationId } }
      });
      if (!state || state.leaseOwnerId !== ownerId) {
        throw Object.assign(new Error('Scheduler lease is owned by another instance (stale scheduler fenced)'), {
          statusCode: 409,
          code: 'STALE_SCHEDULER_OWNER'
        });
      }
    }
    const current = await this.getExecutionState(channelId, organizationId);
    const merged = {
      ...current,
      ...updates,
      channelId,
      organizationId
    };
    const { updatedAt, ...dataFields } = merged;
    dataFields.leaseExpiresAt = BigInt(dataFields.leaseExpiresAt || 0);
    if (dataFields.pendingEffectiveAtUtc) dataFields.pendingEffectiveAtUtc = new Date(dataFields.pendingEffectiveAtUtc);
    if (dataFields.overrideExpiresAtUtc) dataFields.overrideExpiresAtUtc = new Date(dataFields.overrideExpiresAtUtc);
    if (dataFields.lastHeartbeatAt) dataFields.lastHeartbeatAt = new Date(dataFields.lastHeartbeatAt);
    if (dataFields.lastReconciledAt) dataFields.lastReconciledAt = new Date(dataFields.lastReconciledAt);

    const saved = await this.prisma.$transaction(async tx => {
      await ensureOrganization(tx, organizationId);
      return await tx.channelSchedulerExecutionState.upsert({
        where: { channelId_organizationId: { channelId, organizationId } },
        update: dataFields,
        create: dataFields
      });
    });
    return mapSchedulerExecutionStateRow(saved);
  }

  async createAsRunRecord(record) {
    const id = record.id || randomUUID();
    const data = {
      id,
      organizationId: record.organizationId,
      channelId: record.channelId,
      revisionId: record.revisionId || null,
      revisionNumber: record.revisionNumber ?? 0,
      eventId: record.eventId,
      occurrenceId: record.occurrenceId,
      trackType: record.trackType,
      executionMode: record.executionMode,
      title: record.title,
      category: record.category || 'PROGRAM',
      mediaAssetId: record.mediaAssetId || null,
      videoSourceId: record.videoSourceId || null,
      audioSourceId: record.audioSourceId || null,
      plannedStartUtc: new Date(record.plannedStartUtc),
      actualStartUtc: new Date(record.actualStartUtc || new Date()),
      plannedEndUtc: new Date(record.plannedEndUtc),
      actualEndUtc: record.actualEndUtc ? new Date(record.actualEndUtc) : null,
      plannedDurationMs: Number(record.plannedDurationMs),
      actualDurationMs: record.actualDurationMs != null ? Number(record.actualDurationMs) : null,
      status: record.status || 'RUNNING',
      interruptionReason: record.interruptionReason || null,
      resumeOffsetMs: Number(record.resumeOffsetMs ?? 0),
      workerConfirmed: Boolean(record.workerConfirmed),
      details: record.details || {}
    };
    const row = await this.prisma.channelAsRunLog.upsert({
      where: { occurrenceId: record.occurrenceId },
      update: {
        status: data.status,
        actualEndUtc: data.actualEndUtc,
        actualDurationMs: data.actualDurationMs,
        interruptionReason: data.interruptionReason,
        workerConfirmed: data.workerConfirmed,
        details: data.details
      },
      create: data
    });
    return mapAsRunLogRow(row);
  }

  async updateAsRunRecord(id, organizationId, updates) {
    const existing = await this.prisma.channelAsRunLog.findFirst({ where: { id, organizationId } });
    if (!existing) return null;
    const mapped = mapAsRunLogRow(existing);
    const actualEndUtc = updates.actualEndUtc !== undefined ? updates.actualEndUtc : mapped.actualEndUtc;
    const actualDurationMs = updates.actualDurationMs !== undefined
      ? updates.actualDurationMs
      : (actualEndUtc ? Math.max(0, Date.parse(actualEndUtc) - Date.parse(mapped.actualStartUtc)) : mapped.actualDurationMs);

    const row = await this.prisma.channelAsRunLog.update({
      where: { id },
      data: {
        actualEndUtc: actualEndUtc ? new Date(actualEndUtc) : null,
        actualDurationMs: actualDurationMs ?? null,
        status: updates.status ?? mapped.status,
        interruptionReason: updates.interruptionReason !== undefined ? updates.interruptionReason : mapped.interruptionReason,
        workerConfirmed: updates.workerConfirmed !== undefined ? Boolean(updates.workerConfirmed) : mapped.workerConfirmed,
        details: updates.details !== undefined ? { ...mapped.details, ...updates.details } : mapped.details
      }
    });
    return mapAsRunLogRow(row);
  }

  async listAsRunRecords(channelId, organizationId, { trackType = '', status = '', limit = 100 } = {}) {
    const safeLimit = Math.min(500, Math.max(1, Number(limit) || 100));
    const rows = await this.prisma.channelAsRunLog.findMany({
      where: {
        organizationId,
        channelId,
        ...(trackType ? { trackType } : {}),
        ...(status ? { status } : {})
      },
      orderBy: [{ actualStartUtc: 'desc' }, { createdAt: 'desc' }],
      take: safeLimit
    });
    return rows.map(mapAsRunLogRow);
  }
}
