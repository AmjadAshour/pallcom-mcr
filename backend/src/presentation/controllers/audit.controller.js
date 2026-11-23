import { RepositoryFactory } from '../../infrastructure/repositories/repository-factory.js';

export class AuditController {
  static async list(req, res, next) {
    try {
      const auditRepo = RepositoryFactory.getAuditRepository();
      const logs = await auditRepo.findByOrganizationId(req.user.organizationId, {
        limit: parseInt(req.query.limit || '100', 10)
      });

      return res.json({ success: true, count: logs.length, data: logs });
    } catch (err) {
      next(err);
    }
  }
}
