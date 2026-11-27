import { RepositoryFactory } from '../../infrastructure/repositories/repository-factory.js';

export class AuditController {
  static async list(req, res, next) {
    try {
      const { limit: requestedLimit = '100' } = req.query;
      if (typeof requestedLimit !== 'string' || !/^[1-9][0-9]{0,2}$/.test(requestedLimit) || Number(requestedLimit) > 500) {
        return res.status(400).json({ success: false, error: 'Audit limit must be an integer from 1 to 500' });
      }
      const auditRepo = RepositoryFactory.getAuditRepository();
      const logs = await auditRepo.findByOrganizationId(req.user.organizationId, {
        limit: Number(requestedLimit)
      });

      return res.json({ success: true, count: logs.length, data: logs });
    } catch (err) {
      next(err);
    }
  }
}
