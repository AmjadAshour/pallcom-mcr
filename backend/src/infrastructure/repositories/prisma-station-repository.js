import { IStationRepository, Station } from '@mcr/domain';

export class PrismaStationRepository extends IStationRepository {
  constructor(prisma) {
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

  async create(data) {
    const record = await this.prisma.station.create({
      data: {
        organizationId: data.organizationId,
        studioId: data.studioId || null,
        name: data.name,
        slug: data.slug || data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        description: data.description || '',
        ipAddress: data.ipAddress || '127.0.0.1',
        obsPort: data.obsPort || 4455,
        encryptedPassword: data.encryptedPassword || null,
        status: data.status || 'OFFLINE'
      }
    });
    return new Station(record);
  }

  async update(id, organizationId, updateData) {
    const record = await this.prisma.station.update({
      where: { id, organizationId },
      data: updateData
    });
    return new Station(record);
  }

  async updateStatus(id, statusData) {
    return await this.prisma.station.update({
      where: { id },
      data: statusData
    });
  }

  async delete(id, organizationId) {
    const res = await this.prisma.station.deleteMany({
      where: { id, organizationId }
    });
    return res.count > 0;
  }
}
