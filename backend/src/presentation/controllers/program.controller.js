import { configured, inputPreviewFrame, programAction, programMonitorFrame, programStatus,
  setSourceRecovery, startConfiguredProgram } from '../../infrastructure/program/supervisor.js';
import { RepositoryFactory } from '../../infrastructure/repositories/repository-factory.js';
import { rememberProgramSource } from '../../infrastructure/program/resume-source.js';

export async function independentMonitor(req, res, next) {
  try {
    const station = await RepositoryFactory.getStationRepository().findById(req.params.id, req.user.organizationId);
    if (!station || !configured(station.id)) return res.sendStatus(404);
    const data = req.path.endsWith('/program-monitor') ? programMonitorFrame() : inputPreviewFrame(req.query.input);
    res.set('Cache-Control', 'private, no-store').json({ success:true, data });
  } catch (error) { next(error); }
}

export async function independentProgram(req, res, next) {
  try {
    const { id } = req.params;
    const station = await RepositoryFactory.getStationRepository().findById(id, req.user.organizationId);
    if (!station) return res.sendStatus(404);
    if (req.method === 'GET') return res.json({ success: true, data: programStatus(id) });
    if (!configured(id)) return res.status(409).json({ success: false, error: 'Independent Program is not configured' });
    const { action, gainDb } = req.body;
    await RepositoryFactory.getAuditRepository().create({
      organizationId: req.user.organizationId, userId: req.user.id, action: 'PROGRAM_REQUEST',
      resourceType: 'Station', resourceId: id, details: req.body
    });
    const data = action === 'start' ? await startConfiguredProgram(id)
      : await programAction(id, action, undefined, undefined, gainDb);
    if (['obs', 'obs2', 'fallback', 'stop'].includes(action)) {
      rememberProgramSource(id, {source:action === 'stop' ? 'fallback' : action});
      setSourceRecovery(data.session, 'cancelled');
    }
    res.json({ success: true, data });
  } catch (error) { next(error); }
}
