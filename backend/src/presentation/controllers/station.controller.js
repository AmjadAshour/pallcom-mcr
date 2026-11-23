import { RepositoryFactory } from '../../infrastructure/repositories/repository-factory.js';
import { CryptoService } from '../../infrastructure/security/crypto-service.js';
import { agentGateway } from '../../infrastructure/agent/agent-gateway.js';

export class StationController {
  static async list(req, res, next) {
    try {
      const stationRepo = RepositoryFactory.getStationRepository();
      const stations = await stationRepo.findByOrganizationId(req.user.organizationId, req.query);

      // Mask sensitive fields: never send raw or encrypted passwords to the frontend
      const sanitized = stations.map((st) => ({
        id: st.id,
        organizationId: st.organizationId,
        studioId: st.studioId,
        name: st.name,
        slug: st.slug,
        description: st.description,
        ipAddress: st.ipAddress,
        obsPort: st.obsPort,
        hasPassword: Boolean(st.encryptedPassword),
        status: !agentGateway.isAgentOnline(st.id) ? 'OFFLINE'
          : agentGateway.connectedAgents.get(st.id)?.telemetry?.obsConnected === false ? 'DEGRADED' : 'ONLINE',
        streamStatus: st.streamStatus,
        recordStatus: st.recordStatus,
        currentProgramScene: st.currentProgramScene,
        currentPreviewScene: st.currentPreviewScene,
        fps: agentGateway.connectedAgents.get(st.id)?.telemetry?.fps ?? st.fps,
        cpuUsage: agentGateway.connectedAgents.get(st.id)?.telemetry?.cpuUsage ?? st.cpuUsage,
        memoryUsage: agentGateway.connectedAgents.get(st.id)?.telemetry?.memoryUsage ?? st.memoryUsage,
        droppedFrames: agentGateway.connectedAgents.get(st.id)?.telemetry?.droppedFrames ?? st.droppedFrames,
        lastHeartbeat: agentGateway.connectedAgents.get(st.id)?.lastHeartbeat ?? st.lastHeartbeat,
        createdAt: st.createdAt,
        updatedAt: st.updatedAt
      }));

      return res.json({ success: true, count: sanitized.length, data: sanitized });
    } catch (err) {
      next(err);
    }
  }

  static async get(req, res, next) {
    try {
      const stationRepo = RepositoryFactory.getStationRepository();
      const station = await stationRepo.findById(req.params.id, req.user.organizationId);

      if (!station) {
        return res.status(404).json({ success: false, error: 'Station not found' });
      }

      const sanitized = {
        id: station.id,
        organizationId: station.organizationId,
        studioId: station.studioId,
        name: station.name,
        slug: station.slug,
        description: station.description,
        ipAddress: station.ipAddress,
        obsPort: station.obsPort,
        hasPassword: Boolean(station.encryptedPassword),
        status: station.status,
        streamStatus: station.streamStatus,
        recordStatus: station.recordStatus,
        currentProgramScene: station.currentProgramScene,
        currentPreviewScene: station.currentPreviewScene,
        fps: station.fps,
        cpuUsage: station.cpuUsage,
        memoryUsage: station.memoryUsage,
        droppedFrames: station.droppedFrames,
        lastHeartbeat: station.lastHeartbeat,
        createdAt: station.createdAt,
        updatedAt: station.updatedAt
      };

      return res.json({ success: true, data: sanitized });
    } catch (err) {
      next(err);
    }
  }

  static async create(req, res, next) {
    try {
      const { name, studioId, description, ipAddress, obsPort, obsPassword } = req.body;
      const stationRepo = RepositoryFactory.getStationRepository();
      const auditRepo = RepositoryFactory.getAuditRepository();

      const encryptedPassword = obsPassword ? CryptoService.encryptSecret(obsPassword) : null;

      const newStation = await stationRepo.create({
        organizationId: req.user.organizationId,
        studioId,
        name,
        description,
        ipAddress,
        obsPort,
        encryptedPassword
      });

      await auditRepo.create({
        organizationId: req.user.organizationId,
        userId: req.user.id,
        action: 'STATION_CREATED',
        resourceType: 'Station',
        resourceId: newStation.id,
        details: { name: newStation.name, ipAddress: newStation.ipAddress },
        ipAddress: req.ip
      });

      return res.status(201).json({
        success: true,
        data: {
          id: newStation.id,
          name: newStation.name,
          slug: newStation.slug,
          status: newStation.status
        }
      });
    } catch (err) {
      next(err);
    }
  }

  static async update(req, res, next) {
    try {
      const { id } = req.params;
      const { name, studioId, description, ipAddress, obsPort, obsPassword } = req.body;
      const stationRepo = RepositoryFactory.getStationRepository();
      const auditRepo = RepositoryFactory.getAuditRepository();

      const updateData = {};
      if (name !== undefined) updateData.name = name;
      if (studioId !== undefined) updateData.studioId = studioId;
      if (description !== undefined) updateData.description = description;
      if (ipAddress !== undefined) updateData.ipAddress = ipAddress;
      if (obsPort !== undefined) updateData.obsPort = obsPort;
      if (obsPassword !== undefined) {
        updateData.encryptedPassword = CryptoService.encryptSecret(obsPassword);
      }

      const updated = await stationRepo.update(id, req.user.organizationId, updateData);
      if (!updated) {
        return res.status(404).json({ success: false, error: 'Station not found' });
      }

      await auditRepo.create({
        organizationId: req.user.organizationId,
        userId: req.user.id,
        action: 'STATION_UPDATED',
        resourceType: 'Station',
        resourceId: id,
        details: { updatedFields: Object.keys(updateData) },
        ipAddress: req.ip
      });

      return res.json({ success: true, data: { id: updated.id, name: updated.name } });
    } catch (err) {
      next(err);
    }
  }

  static async delete(req, res, next) {
    try {
      const { id } = req.params;
      const stationRepo = RepositoryFactory.getStationRepository();
      const auditRepo = RepositoryFactory.getAuditRepository();

      const deleted = await stationRepo.delete(id, req.user.organizationId);
      if (!deleted) {
        return res.status(404).json({ success: false, error: 'Station not found' });
      }
      agentGateway.disconnectDeletedStation(id);

      await auditRepo.create({
        organizationId: req.user.organizationId,
        userId: req.user.id,
        action: 'STATION_DELETED',
        resourceType: 'Station',
        resourceId: id,
        ipAddress: req.ip
      });

      return res.json({ success: true, message: 'Station deleted successfully' });
    } catch (err) {
      next(err);
    }
  }
}
