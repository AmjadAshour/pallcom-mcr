import { configured, programAction, programStatus } from '../../infrastructure/program/supervisor.js';
import { storedWatermark } from '../../infrastructure/program/watermark.js';
import { createAdRenderer } from '../../infrastructure/program/ads.js';
import { RepositoryFactory } from '../../infrastructure/repositories/repository-factory.js';

export async function independentProgram(req, res, next) {
  try {
    const { id } = req.params;
    const station = await RepositoryFactory.getStationRepository().findById(id, req.user.organizationId);
    if (!station) return res.sendStatus(404);
    if (req.method === 'GET') return res.json({ success: true, data: programStatus(id) });
    if (!configured(id)) return res.status(409).json({ success: false, error: 'Independent Program is not configured' });
    const { action } = req.body;
    await RepositoryFactory.getAuditRepository().create({
      organizationId: req.user.organizationId, userId: req.user.id, action: 'PROGRAM_REQUEST',
      resourceType: 'Station', resourceId: id, details: { action }
    });
    const data = await programAction(id, action, action === 'start' ? storedWatermark(id) : undefined,
      action === 'start' ? createAdRenderer(id) : undefined);
    res.json({ success: true, data });
  } catch (error) { next(error); }
}
