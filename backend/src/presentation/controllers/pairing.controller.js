import { RepositoryFactory } from '../../infrastructure/repositories/repository-factory.js';
import { CryptoService } from '../../infrastructure/security/crypto-service.js';

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

      const pairingCode = CryptoService.generatePairingCode();
      const rawToken = CryptoService.generateRandomToken(32);
      const tokenHash = CryptoService.hashToken(rawToken);

      const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes TTL

      await pairingRepo.createToken({
        stationId: station.id,
        pairingCode,
        tokenHash,
        expiresAt,
        createdByUserId: req.user.id
      });

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
      const { pairingCode, machineHostname, osPlatform, agentVersion } = req.body;
      const pairingRepo = RepositoryFactory.getPairingRepository();
      const stationRepo = RepositoryFactory.getStationRepository();
      const auditRepo = RepositoryFactory.getAuditRepository();

      const tokenRecord = await pairingRepo.findByCode(pairingCode);
      if (!tokenRecord) {
        return res.status(400).json({ success: false, error: 'Invalid pairing code' });
      }

      if (new Date() > new Date(tokenRecord.expiresAt)) {
        return res.status(400).json({ success: false, error: 'Pairing code has expired' });
      }

      // Mark token as used immediately

      // Decrypt OBS password only for the verified agent on localhost
      const operator = await RepositoryFactory.getUserRepository().findById(tokenRecord.createdByUserId);
      const organizationId = operator?.organizationId || 'default-org';
      const station = await stationRepo.findById(tokenRecord.stationId, organizationId);
      if (!operator?.isActive || !station) {
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
      if (!await pairingRepo.markUsed(tokenRecord.id)) {
        return res.status(400).json({ success: false, error: 'Pairing code is no longer valid' });
      }

      await auditRepo.create({
        organizationId,
        userId: tokenRecord.createdByUserId,
        action: 'AGENT_PAIRED_SUCCESS',
        resourceType: 'StationAgent',
        resourceId: tokenRecord.stationId,
        details: { machineHostname, osPlatform, agentVersion },
        ipAddress: req.ip
      });

      return res.json({
        success: true,
        stationId: tokenRecord.stationId,
        agentToken: CryptoService.signAgentToken(station.id, organizationId),
        obsConfig: {
          port: station ? station.obsPort : 4455,
          password: decryptedObsPassword
        }
      });
    } catch (err) {
      next(err);
    }
  }
}
