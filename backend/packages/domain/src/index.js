import { STATION_STATUS, STREAM_STATUS, RECORD_STATUS } from '@mcr/shared';

/**
 * Domain Entities
 */
export class Station {
  constructor({
    id,
    organizationId,
    studioId = null,
    name,
    slug,
    description = '',
    ipAddress = '127.0.0.1',
    obsPort = 4455,
    encryptedPassword = null,
    status = STATION_STATUS.OFFLINE,
    streamStatus = STREAM_STATUS.STOPPED,
    recordStatus = RECORD_STATUS.STOPPED,
    currentProgramScene = null,
    currentPreviewScene = null,
    fps = 0.0,
    cpuUsage = 0.0,
    memoryUsage = 0.0,
    droppedFrames = 0,
    lastHeartbeat = null,
    createdAt = new Date(),
    updatedAt = new Date()
  }) {
    this.id = id;
    this.organizationId = organizationId;
    this.studioId = studioId;
    this.name = name;
    this.slug = slug;
    this.description = description;
    this.ipAddress = ipAddress;
    this.obsPort = obsPort;
    Object.defineProperty(this, 'encryptedPassword', { value: encryptedPassword });
    this.status = status;
    this.streamStatus = streamStatus;
    this.recordStatus = recordStatus;
    this.currentProgramScene = currentProgramScene;
    this.currentPreviewScene = currentPreviewScene;
    this.fps = fps;
    this.cpuUsage = cpuUsage;
    this.memoryUsage = memoryUsage;
    this.droppedFrames = droppedFrames;
    this.lastHeartbeat = lastHeartbeat;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
  }

  isOnline() {
    return this.status === STATION_STATUS.ONLINE;
  }

  isStreaming() {
    return this.streamStatus === STREAM_STATUS.STREAMING;
  }

  isRecording() {
    return this.recordStatus === RECORD_STATUS.RECORDING;
  }
}

export class User {
  constructor({
    id,
    email,
    fullName,
    role = 'OPERATOR',
    organizationId = 'default-org',
    isActive = true,
    createdAt = new Date(),
    updatedAt = new Date()
  }) {
    this.id = id;
    this.email = email;
    this.fullName = fullName;
    this.role = role;
    this.organizationId = organizationId;
    this.isActive = isActive;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
  }
}

export class Studio {
  constructor({
    id,
    organizationId,
    name,
    description = '',
    createdAt = new Date(),
    updatedAt = new Date()
  }) {
    this.id = id;
    this.organizationId = organizationId;
    this.name = name;
    this.description = description;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
  }
}

/**
 * Clean Architecture Abstract Repository Interfaces
 */
export class IStationRepository {
  async findById(id, organizationId) { throw new Error('Not implemented'); }
  async findByOrganizationId(organizationId, filters = {}) { throw new Error('Not implemented'); }
  async create(stationData) { throw new Error('Not implemented'); }
  async update(id, organizationId, updateData) { throw new Error('Not implemented'); }
  async updateStatus(id, statusData) { throw new Error('Not implemented'); }
  async delete(id, organizationId) { throw new Error('Not implemented'); }
}

export class IUserRepository {
  async findById(id) { throw new Error('Not implemented'); }
  async findByEmail(email) { throw new Error('Not implemented'); }
  async create(userData) { throw new Error('Not implemented'); }
  async update(id, updateData) { throw new Error('Not implemented'); }
}

export class IAuditLogRepository {
  async create({ organizationId, userId, action, resourceType, resourceId, details, ipAddress }) {
    throw new Error('Not implemented');
  }
  async findByOrganizationId(organizationId, options = {}) {
    throw new Error('Not implemented');
  }
}

export class IObsGateway {
  async executeCommand(stationId, command, params = {}) { throw new Error('Not implemented'); }
  async isStationConnected(stationId) { throw new Error('Not implemented'); }
  subscribe(stationId, callback) { throw new Error('Not implemented'); }
}

export class IMediaRepository {
  async createUploadSession(session, actor) { throw new Error('Not implemented'); }
  async findUploadSession(id, organizationId) { throw new Error('Not implemented'); }
  async listUploadSessions(organizationId, filters = {}) { throw new Error('Not implemented'); }
  async updateUploadSessionProgress(id, organizationId, progress) { throw new Error('Not implemented'); }
  async cancelUploadSession(id, organizationId, actor) { throw new Error('Not implemented'); }
  async expireAbandonedUploads(nowMs) { throw new Error('Not implemented'); }
  async createAsset(asset, actor) { throw new Error('Not implemented'); }
  async updateAssetProcessing(id, organizationId, updates) { throw new Error('Not implemented'); }
  async updateAssetMetadata(id, organizationId, updates, actor) { throw new Error('Not implemented'); }
  async findAssetById(id, organizationId) { throw new Error('Not implemented'); }
  async listAssets(organizationId, query = {}) { throw new Error('Not implemented'); }
  async getStorageUsage(organizationId) { throw new Error('Not implemented'); }
  async inspectAssetReferences(id, organizationId) { throw new Error('Not implemented'); }
  async deleteAsset(id, organizationId, actor) { throw new Error('Not implemented'); }
  async createPlaylist(playlist, actor) { throw new Error('Not implemented'); }
  async listPlaylists(organizationId, filters = {}) { throw new Error('Not implemented'); }
  async deletePlaylist(id, organizationId, actor) { throw new Error('Not implemented'); }
}

export class IVideoSourceRepository {
  async createSource(source, actor) { throw new Error('Not implemented'); }
  async updateSource(id, organizationId, updates, actor) { throw new Error('Not implemented'); }
  async updateSourceProbeState(id, organizationId, probeResult) { throw new Error('Not implemented'); }
  async findSourceById(id, organizationId) { throw new Error('Not implemented'); }
  async listSources(organizationId, filters = {}) { throw new Error('Not implemented'); }
  async deleteSource(id, organizationId, actor) { throw new Error('Not implemented'); }
}

export class IAudioRepository {
  async createAudioSource(source, actor) { throw new Error('Not implemented'); }
  async updateAudioSource(id, organizationId, updates, actor) { throw new Error('Not implemented'); }
  async updateAudioSourceRuntimeState(id, organizationId, runtimeState) { throw new Error('Not implemented'); }
  async findAudioSourceById(id, organizationId, options = {}) { throw new Error('Not implemented'); }
  async listAudioSources(organizationId, filters = {}) { throw new Error('Not implemented'); }
  async deleteAudioSource(id, organizationId, actor) { throw new Error('Not implemented'); }
  async getChannelMixerConfig(channelId, organizationId) { throw new Error('Not implemented'); }
  async saveChannelMixerConfig(channelId, organizationId, config, actor) { throw new Error('Not implemented'); }
}

export class IChannelPlayoutRepository {
  async getChannelConfig(channelId, organizationId) { throw new Error('Not implemented'); }
  async listChannelConfigs(organizationId) { throw new Error('Not implemented'); }
  async saveChannelConfig(channelId, organizationId, updates, actor) { throw new Error('Not implemented'); }
  async updateRuntimeCheckpoint(channelId, organizationId, checkpoint) { throw new Error('Not implemented'); }
}

export class IBroadcastSchedulerRepository {
  async getOrCreateDraftRevision(channelId, organizationId, actor) { throw new Error('Not implemented'); }
  async saveDraftRevision(channelId, organizationId, draftPayload, actor) { throw new Error('Not implemented'); }
  async markRevisionValidated(revisionId, organizationId, validationSummary, actor) { throw new Error('Not implemented'); }
  async publishRevision(channelId, organizationId, options, actor) { throw new Error('Not implemented'); }
  async getActivePublishedRevision(channelId, organizationId) { throw new Error('Not implemented'); }
  async getRevisionById(revisionId, organizationId) { throw new Error('Not implemented'); }
  async listRevisions(channelId, organizationId) { throw new Error('Not implemented'); }
  async getExecutionState(channelId, organizationId) { throw new Error('Not implemented'); }
  async updateExecutionState(channelId, organizationId, updates, options = {}) { throw new Error('Not implemented'); }
  async acquireSchedulerLease(channelId, organizationId, ownerId, nowMs, ttlMs) { throw new Error('Not implemented'); }
  async releaseSchedulerLease(channelId, organizationId, ownerId) { throw new Error('Not implemented'); }
  async claimOccurrence(record, options = {}) { throw new Error('Not implemented'); }
  async createAsRunRecord(record) { throw new Error('Not implemented'); }
  async updateAsRunRecord(id, organizationId, updates) { throw new Error('Not implemented'); }
  async listAsRunRecords(channelId, organizationId, filters = {}) { throw new Error('Not implemented'); }
}
