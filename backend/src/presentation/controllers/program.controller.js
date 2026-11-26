import { configured, inputPreviewFrame, listenProgramAudio, programAction, programHlsDirectory, programMonitorFrame, programStatus,
  setSourceRecovery, startConfiguredProgram } from '../../infrastructure/program/supervisor.js';
import { RepositoryFactory } from '../../infrastructure/repositories/repository-factory.js';
import { rememberProgramSource } from '../../infrastructure/program/resume-source.js';
import { authorizeReceiver, recordReceiver } from '../../infrastructure/program/receiver-health.js';
import { activeSessionUser } from '../../infrastructure/security/session-service.js';
import { hasPermission } from '../middlewares/rbac.middleware.js';

export function reportProgramReceiver(req, res) {
  const { id, destination } = req.params;
  if (!configured(id) || !authorizeReceiver(destination, req.get('Authorization'))) {
    return res.sendStatus(401);
  }
  const status = programStatus(id);
  if (status.state !== 'running' || !status.srtDestinations?.some(output => output.id === destination)) {
    return res.sendStatus(409);
  }
  recordReceiver(destination, status.session, req.body);
  return res.sendStatus(204);
}

export async function independentMonitor(req, res, next) {
  try {
    const station = await RepositoryFactory.getStationRepository().findById(req.params.id, req.user.organizationId);
    if (!station || !configured(station.id)) return res.sendStatus(404);
    const data = req.path.endsWith('/program-monitor') ? programMonitorFrame() : inputPreviewFrame(req.query.input);
    res.set('Cache-Control', 'private, no-store').json({ success:true, data });
  } catch (error) { next(error); }
}

export async function independentAudioMonitor(req, res, next) {
  try {
    const { id } = req.params;
    const { id: userId, sessionId, organizationId } = req.user;
    const repository = RepositoryFactory.getStationRepository();
    const station = await repository.findById(id, organizationId);
    if (!station || !configured(station.id)) return res.sendStatus(404);
    if (req.method !== 'GET') return res.sendStatus(405);
    if (res.destroyed) return;
    listenProgramAudio(station.id, res);
    let timer;
    async function checkAccess() {
      try {
        const user = activeSessionUser(sessionId, userId);
        if (!user || user.organizationId !== organizationId || !hasPermission(user.role, 'station:read') ||
          !await repository.findById(id, organizationId)) return res.end();
        if (!res.destroyed && !res.writableEnded) timer = setTimeout(checkAccess, 5000);
      } catch {
        res.end();
      }
    }
    timer = setTimeout(checkAccess, 5000);
    res.once('close', () => clearTimeout(timer));
  } catch (error) { next(error); }
}

export async function independentHls(req, res, next) {
  try {
    const { id, session, filename } = req.params;
    const station = await RepositoryFactory.getStationRepository().findById(id, req.user.organizationId);
    const root = station && programHlsDirectory(id, session, filename);
    if (!root) return res.sendStatus(404);
    res.set({
      'Content-Type': filename.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t',
      'Cache-Control': 'private, no-store',
    });
    res.sendFile(filename, { root, dotfiles: 'deny', cacheControl: false, lastModified: false }, error => {
      if (!error || res.destroyed) return;
      if (res.headersSent) return res.destroy();
      res.removeHeader('Content-Type');
      if (error.status === 404 || error.code === 'ENOENT') return res.sendStatus(404);
      next(error);
    });
  } catch (error) { next(error); }
}

export async function independentProgram(req, res, next) {
  try {
    const { id } = req.params;
    const station = await RepositoryFactory.getStationRepository().findById(id, req.user.organizationId);
    if (!station) return res.sendStatus(404);
    if (req.method === 'GET') return res.json({ success: true, data: programStatus(id) });
    if (!configured(id)) return res.status(409).json({ success: false, error: 'Independent Program is not configured' });
    const { action, gainDb, inputAudio } = req.body;
    await RepositoryFactory.getAuditRepository().create({
      organizationId: req.user.organizationId, userId: req.user.id, action: 'PROGRAM_REQUEST',
      resourceType: 'Station', resourceId: id, details: req.body
    });
    const data = action === 'start' ? await startConfiguredProgram(id)
      : await programAction(id, action, undefined, undefined, action === 'input-audio' ? inputAudio : gainDb);
    if (['obs', 'obs2', 'fallback', 'stop'].includes(action)) {
      rememberProgramSource(id, {source:action === 'stop' ? 'fallback' : action});
      setSourceRecovery(data.session, 'cancelled');
    }
    res.json({ success: true, data });
  } catch (error) { next(error); }
}
