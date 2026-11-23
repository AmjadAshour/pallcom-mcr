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
