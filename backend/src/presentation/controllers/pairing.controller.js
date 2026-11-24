import { RepositoryFactory } from '../../infrastructure/repositories/repository-factory.js';
import { CryptoService } from '../../infrastructure/security/crypto-service.js';
import { ROLE_PERMISSIONS } from '@mcr/shared';
import { agentGateway } from '../../infrastructure/agent/agent-gateway.js';
import { rotateAgentCredential } from '../../infrastructure/agent/agent-credentials.js';

export class PairingController {
  static async generate(req, res, next) {
    try {
      const { stationId } = req.body;
      const pairingRepo = RepositoryFactory.getPairingRepository();
      const stationRepo = RepositoryFactory.getStationRepository();

      const station = await stationRepo.findById(stationId, req.user.organizationId);
      if (!station) {
        return res.status(404).json({ success: false, error: 'Station not found' });
      }

      const rawToken = CryptoService.generateRandomToken(32);
      const tokenHash = CryptoService.hashToken(rawToken);

      const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes TTL

      let pairingCode;
      for (let attempt = 0; attempt < 5; attempt++) {
        pairingCode = CryptoService.generatePairingCode();
        if (await pairingRepo.createToken({
          stationId: station.id, pairingCode, tokenHash, expiresAt, createdByUserId: req.user.id
        })) break;
        pairingCode = null;
      }
      if (!pairingCode) return res.status(503).json({ success: false, error: 'Could not allocate a pairing code. Retry.' });

      res.set('Cache-Control', 'no-store');
      return res.status(201).json({
        success: true,
        pairingCode,
        expiresAt: expiresAt.toISOString(),
        instructions: `Run: node backend/agent/src/index.js pair --code ${pairingCode}`
      });
    } catch (err) {
      next(err);
    }
  }

  static async claim(req, res, next) {
    try {
      const { pairingCode } = req.body;
      const pairingRepo = RepositoryFactory.getPairingRepository();
      const stationRepo = RepositoryFactory.getStationRepository();

      const tokenRecord = await pairingRepo.findByCode(pairingCode);
      if (!tokenRecord) {
        return res.status(400).json({ success: false, error: 'Invalid pairing code' });
      }

      if (new Date() > new Date(tokenRecord.expiresAt)) {
        return res.status(400).json({ success: false, error: 'Pairing code has expired' });
      }

      const operator = await RepositoryFactory.getUserRepository().findById(tokenRecord.createdByUserId);
      const permissions = ROLE_PERMISSIONS[operator?.role] ?? [];
      const organizationId = operator?.organizationId || 'default-org';
      const station = await stationRepo.findById(tokenRecord.stationId, organizationId);
      if (!operator?.isActive || !station || !(permissions.includes('*') || permissions.includes('station:manage'))) {
        return res.status(404).json({ success: false, error: 'Station unavailable' });
      }
      let decryptedObsPassword = '';
      if (station.encryptedPassword) {
        try {
          decryptedObsPassword = CryptoService.decryptSecret(station.encryptedPassword);
        } catch {
          return res.status(500).json({ success: false, error: 'Could not read the station OBS password. Save it again before pairing.' });
        }
      }
      const generation = rotateAgentCredential(station.id, organizationId, {
        pairingId: tokenRecord.id, actorId: tokenRecord.createdByUserId, ipAddress: req.ip
      });
      if (generation === null) {
        return res.status(400).json({ success: false, error: 'Pairing code is no longer valid' });
      }
      agentGateway.disconnectAgent(station.id, 4003, 'Agent credentials rotated');

      res.set('Cache-Control', 'no-store');
      return res.json({
        success: true,
        stationId: tokenRecord.stationId,
        agentToken: CryptoService.signAgentToken(station.id, organizationId, generation),
        obsConfig: {
          port: station ? station.obsPort : 4455,
          password: decryptedObsPassword
        }
      });
    } catch (err) {
      next(err);
    }
  }

  static async revoke(req, res, next) {
    try {
      const stationId = req.params.id;
      const { id, organizationId } = req.user;
      if (rotateAgentCredential(stationId, organizationId, { actorId: id, ipAddress: req.ip }) === null) {
        return res.status(404).json({ success: false, error: 'Station not found' });
      }
      agentGateway.disconnectAgent(stationId, 4003, 'Agent credentials revoked');
      return res.json({ success: true });
    } catch (error) {
      next(error);
    }
  }
}
