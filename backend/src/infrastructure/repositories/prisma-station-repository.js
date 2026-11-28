import { randomUUID } from 'node:crypto';
import { IStationRepository, Station } from '@mcr/domain';
import { getPrismaClient } from '../database/mysql-prisma.js';

export class PrismaStationRepository extends IStationRepository {
  constructor(prisma = getPrismaClient()) {
    super();
    this.prisma = prisma;
  }

  async findById(id, organizationId) {
    const record = await this.prisma.station.findFirst({
      where: { id, organizationId }
    });
    return record ? new Station(record) : null;
  }

  async findByOrganizationId(organizationId, filters = {}) {
    const where = { organizationId };
    if (filters.status) where.status = filters.status;
    if (filters.streamStatus) where.streamStatus = filters.streamStatus;

    const records = await this.prisma.station.findMany({
      where,
      orderBy: { createdAt: 'desc' }
    });
    return records.map((r) => new Station(r));
  }

  async create(data, audit = null) {
    const id = data.id || randomUUID();
    const slug = data.slug || (data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + id.slice(0, 6));
    return await this.prisma.$transaction(async tx => {
      await tx.organization.upsert({
        where: { id: data.organizationId },
        update: {},
        create: {
          id: data.organizationId,
          name: data.organizationId,
          slug: data.organizationId.toLowerCase().replace(/[^a-z0-9-]+/g, '-') + '-' + data.organizationId.slice(0, 6)
        }
      });
      if (data.studioId != null) {
        const studio = await tx.studio.findFirst({
          where: { id: data.studioId, organizationId: data.organizationId }
        });
        if (!studio) throw Object.assign(new Error('Studio not found'), { statusCode: 404 });
      }
      const record = await tx.station.create({
        data: {
          id,
          organizationId: data.organizationId,
          studioId: data.studioId || null,
          name: data.name,
          slug,
          description: data.description || '',
          ipAddress: data.ipAddress || '127.0.0.1',
          obsPort: data.obsPort || 4455,
          encryptedPassword: data.encryptedPassword || null,
          status: data.status || 'OFFLINE'
        }
      });
      if (audit) {
        await tx.auditLog.create({
          data: {
            id: randomUUID(),
            organizationId: data.organizationId,
            action: 'STATION_CREATED',
            resourceType: 'Station',
            resourceId: id,
            details: { actorId: audit.userId, name: data.name, ipAddress: data.ipAddress || '127.0.0.1' },
            ipAddress: audit.ipAddress || null
          }
        });
      }
      return new Station(record);
    });
  }

  async update(id, organizationId, updateData, audit = null) {
    return await this.prisma.$transaction(async tx => {
      const existing = await tx.station.findFirst({ where: { id, organizationId } });
      if (!existing) return null;
      if (updateData.studioId != null && updateData.studioId !== existing.studioId) {
        const studio = await tx.studio.findFirst({
          where: { id: updateData.studioId, organizationId }
        });
        if (!studio) throw Object.assign(new Error('Studio not found'), { statusCode: 404 });
      }
      const record = await tx.station.update({
        where: { id },
        data: updateData
      });
      if (audit) {
        await tx.auditLog.create({
          data: {
            id: randomUUID(),
            organizationId,
            action: 'STATION_UPDATED',
            resourceType: 'Station',
            resourceId: id,
            details: { actorId: audit.userId, updatedFields: Object.keys(updateData) },
            ipAddress: audit.ipAddress || null
          }
        });
      }
      return new Station(record);
    });
  }

  async updateStatus(id, statusData) {
    return await this.prisma.station.update({
      where: { id },
      data: statusData
    });
  }

  async delete(id, organizationId, audit = null) {
    return await this.prisma.$transaction(async tx => {
      const res = await tx.station.deleteMany({
        where: { id, organizationId }
      });
      if (res.count > 0 && audit) {
        await tx.auditLog.create({
          data: {
            id: randomUUID(),
            organizationId,
            action: 'STATION_DELETED',
            resourceType: 'Station',
            resourceId: id,
            details: { actorId: audit.userId },
            ipAddress: audit.ipAddress || null
          }
        });
      }
      return res.count > 0;
    });
  }
}
