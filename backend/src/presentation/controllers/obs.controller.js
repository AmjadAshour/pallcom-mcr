import { agentGateway } from '../../infrastructure/agent/agent-gateway.js';
import { RepositoryFactory } from '../../infrastructure/repositories/repository-factory.js';
import { OBS_COMMANDS } from '@mcr/shared';

export class ObsController {
  static stationCommand(command, params = () => ({})) {
    return async (req, res, next) => {
      try {
        const station = await RepositoryFactory.getStationRepository().findById(req.params.id, req.user.organizationId);
        if (!station) return res.status(404).json({ success: false, error: 'Station not found' });
        if (!agentGateway.isAgentOnline(station.id)) return res.status(503).json({ success: false, error: 'Station is offline' });
        const data = await agentGateway.sendCommand(station.id, command, params(req));
        if (req.method === 'POST') {
          await RepositoryFactory.getAuditRepository().create({
            organizationId: req.user.organizationId, userId: req.user.id,
            action: command, resourceType: 'Station', resourceId: station.id, ipAddress: req.ip
          });
        }
        res.json({ success: true, data });
      } catch (error) {
        next(error);
      }
    };
  }
  static async getScenes(req, res, next) {
    try {
      const { id: stationId } = req.params;
      const stationRepo = RepositoryFactory.getStationRepository();
      const station = await stationRepo.findById(stationId, req.user.organizationId);

      if (!station) {
        return res.status(404).json({ success: false, error: 'Station not found or access denied' });
      }

      if (!agentGateway.isAgentOnline(stationId)) {
        return res.status(503).json({
          success: false,
          error: `Station [${station.name}] agent is currently offline.`
        });
      }

      const result = await agentGateway.sendCommand(stationId, OBS_COMMANDS.GET_SCENE_LIST);
      return res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }

  static async switchScene(req, res, next) {
    try {
      const { id: stationId } = req.params;
      const { sceneName, preview = false } = req.body;

      const stationRepo = RepositoryFactory.getStationRepository();
      const auditRepo = RepositoryFactory.getAuditRepository();
      const station = await stationRepo.findById(stationId, req.user.organizationId);

      if (!station) {
        return res.status(404).json({ success: false, error: 'Station not found or access denied' });
      }

      const command = preview
        ? OBS_COMMANDS.SET_CURRENT_PREVIEW_SCENE
        : OBS_COMMANDS.SET_CURRENT_PROGRAM_SCENE;

      await agentGateway.sendCommand(stationId, command, { sceneName });

      // Update station state in repository
      await stationRepo.updateStatus(stationId, {
        [preview ? 'currentPreviewScene' : 'currentProgramScene']: sceneName
      });

      await auditRepo.create({
        organizationId: req.user.organizationId,
        userId: req.user.id,
        action: preview ? 'SCENE_SWITCH_PREVIEW' : 'SCENE_SWITCH_PROGRAM',
        resourceType: 'Station',
        resourceId: stationId,
        details: { sceneName, stationName: station.name },
        ipAddress: req.ip
      });

      return res.json({
        success: true,
        message: `Switched ${preview ? 'Preview' : 'Program'} to "${sceneName}" on ${station.name}`
      });
    } catch (err) {
      next(err);
    }
  }

  static async startStream(req, res, next) {
    try {
      const { id: stationId } = req.params;
      const stationRepo = RepositoryFactory.getStationRepository();
      const auditRepo = RepositoryFactory.getAuditRepository();
      const station = await stationRepo.findById(stationId, req.user.organizationId);

      if (!station) {
        return res.status(404).json({ success: false, error: 'Station not found' });
      }

      await agentGateway.sendCommand(stationId, OBS_COMMANDS.START_STREAM);
      await stationRepo.updateStatus(stationId, { streamStatus: 'STREAMING' });

      await auditRepo.create({
        organizationId: req.user.organizationId,
        userId: req.user.id,
        action: 'STREAM_STARTED',
        resourceType: 'Station',
        resourceId: stationId,
        details: { stationName: station.name },
        ipAddress: req.ip
      });

      return res.json({ success: true, message: `Stream started on ${station.name}` });
    } catch (err) {
      next(err);
    }
  }

  static async stopStream(req, res, next) {
    try {
      const { id: stationId } = req.params;
      const stationRepo = RepositoryFactory.getStationRepository();
      const auditRepo = RepositoryFactory.getAuditRepository();
      const station = await stationRepo.findById(stationId, req.user.organizationId);

      if (!station) {
        return res.status(404).json({ success: false, error: 'Station not found' });
      }

      await agentGateway.sendCommand(stationId, OBS_COMMANDS.STOP_STREAM);
      await stationRepo.updateStatus(stationId, { streamStatus: 'STOPPED' });

      await auditRepo.create({
        organizationId: req.user.organizationId,
        userId: req.user.id,
        action: 'STREAM_STOPPED',
        resourceType: 'Station',
        resourceId: stationId,
        details: { stationName: station.name },
        ipAddress: req.ip
      });

      return res.json({ success: true, message: `Stream stopped on ${station.name}` });
    } catch (err) {
      next(err);
    }
  }

  static async startRecord(req, res, next) {
    try {
      const { id: stationId } = req.params;
      const stationRepo = RepositoryFactory.getStationRepository();
      const auditRepo = RepositoryFactory.getAuditRepository();
      const station = await stationRepo.findById(stationId, req.user.organizationId);

      if (!station) {
        return res.status(404).json({ success: false, error: 'Station not found' });
      }

      await agentGateway.sendCommand(stationId, OBS_COMMANDS.START_RECORD);
      await stationRepo.updateStatus(stationId, { recordStatus: 'RECORDING' });

      await auditRepo.create({
        organizationId: req.user.organizationId,
        userId: req.user.id,
        action: 'RECORD_STARTED',
        resourceType: 'Station',
        resourceId: stationId,
        details: { stationName: station.name },
        ipAddress: req.ip
      });

      return res.json({ success: true, message: `Recording started on ${station.name}` });
    } catch (err) {
      next(err);
    }
  }

  static async stopRecord(req, res, next) {
    try {
      const { id: stationId } = req.params;
      const stationRepo = RepositoryFactory.getStationRepository();
      const auditRepo = RepositoryFactory.getAuditRepository();
      const station = await stationRepo.findById(stationId, req.user.organizationId);

      if (!station) {
        return res.status(404).json({ success: false, error: 'Station not found' });
      }

      await agentGateway.sendCommand(stationId, OBS_COMMANDS.STOP_RECORD);
      await stationRepo.updateStatus(stationId, { recordStatus: 'STOPPED' });

      await auditRepo.create({
        organizationId: req.user.organizationId,
        userId: req.user.id,
        action: 'RECORD_STOPPED',
        resourceType: 'Station',
        resourceId: stationId,
        details: { stationName: station.name },
        ipAddress: req.ip
      });

      return res.json({ success: true, message: `Recording stopped on ${station.name}` });
    } catch (err) {
      next(err);
    }
  }

  static async setVolume(req, res, next) {
    try {
      const { id: stationId } = req.params;
      const { inputName, inputVolumeMul, inputVolumeDb } = req.body;
      const stationRepo = RepositoryFactory.getStationRepository();
      const auditRepo = RepositoryFactory.getAuditRepository();
      const station = await stationRepo.findById(stationId, req.user.organizationId);

      if (!station) {
        return res.status(404).json({ success: false, error: 'Station not found' });
      }

      await agentGateway.sendCommand(stationId, OBS_COMMANDS.SET_INPUT_VOLUME, {
        inputName,
        inputVolumeMul,
        inputVolumeDb
      });

      await auditRepo.create({
        organizationId: req.user.organizationId,
        userId: req.user.id,
        action: 'AUDIO_VOLUME_UPDATED',
        resourceType: 'Station',
        resourceId: stationId,
        details: {
          inputName,
          ...(inputVolumeMul !== undefined && { inputVolumeMul }),
          ...(inputVolumeDb !== undefined && { inputVolumeDb })
        },
        ipAddress: req.ip
      });

      return res.json({ success: true, message: `Volume updated for ${inputName}` });
    } catch (err) {
      next(err);
    }
  }

  static async setMute(req, res, next) {
    try {
      const { id: stationId } = req.params;
      const { inputName, inputMuted } = req.body;
      const stationRepo = RepositoryFactory.getStationRepository();
      const auditRepo = RepositoryFactory.getAuditRepository();
      const station = await stationRepo.findById(stationId, req.user.organizationId);

      if (!station) {
        return res.status(404).json({ success: false, error: 'Station not found' });
      }

      await agentGateway.sendCommand(stationId, OBS_COMMANDS.SET_INPUT_MUTE, {
        inputName,
        inputMuted
      });

      await auditRepo.create({
        organizationId: req.user.organizationId,
        userId: req.user.id,
        action: 'AUDIO_MUTE_UPDATED',
        resourceType: 'Station',
        resourceId: stationId,
        details: { inputName, inputMuted },
        ipAddress: req.ip
      });

      return res.json({ success: true, message: `Mute state updated for ${inputName}` });
    } catch (err) {
      next(err);
    }
  }

  static async triggerStudioTransition(req, res, next) {
    try {
      const { id: stationId } = req.params;
      const stationRepo = RepositoryFactory.getStationRepository();
      const auditRepo = RepositoryFactory.getAuditRepository();
      const station = await stationRepo.findById(stationId, req.user.organizationId);

      if (!station) {
        return res.status(404).json({ success: false, error: 'Station not found' });
      }

      await agentGateway.sendCommand(stationId, OBS_COMMANDS.TRIGGER_STUDIO_MODE_TRANSITION);

      await auditRepo.create({
        organizationId: req.user.organizationId,
        userId: req.user.id,
        action: OBS_COMMANDS.TRIGGER_STUDIO_MODE_TRANSITION,
        resourceType: 'Station',
        resourceId: stationId,
        ipAddress: req.ip
      });

      return res.json({ success: true, message: 'Studio mode transition triggered' });
    } catch (err) {
      next(err);
    }
  }
}
