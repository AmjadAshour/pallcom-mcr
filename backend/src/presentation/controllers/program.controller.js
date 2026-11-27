import { configured, inputPreviewFrame, listenProgramAudio, programAction, programHlsDirectory, programMonitorFrame, programStatus,
  selectProgramStation, setSourceRecovery, startConfiguredProgram } from '../../infrastructure/program/supervisor.js';
import { RepositoryFactory } from '../../infrastructure/repositories/repository-factory.js';
import { rememberProgramSource } from '../../infrastructure/program/resume-source.js';
import { authorizeReceiver, recordReceiver } from '../../infrastructure/program/receiver-health.js';
import { CryptoService } from '../../infrastructure/security/crypto-service.js';
import { activeSessionUser } from '../../infrastructure/security/session-service.js';
import { hasPermission } from '../middlewares/rbac.middleware.js';
import { hasCurrentPermission } from '../middlewares/auth.middleware.js';

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
    const { organizationId } = req.user;
    const expiresAt = res.locals.accessTokenExpiresAt;
    const canListen = () => Number.isFinite(expiresAt) && Date.now() < expiresAt &&
      hasCurrentPermission(req.user, 'station:read');
    const repository = RepositoryFactory.getStationRepository();
    const station = await repository.findById(id, organizationId);
    if (!station || !configured(station.id)) return res.sendStatus(404);
    if (req.method !== 'GET') return res.sendStatus(405);
    if (res.destroyed) return;
    if (!canListen()) return res.sendStatus(401);
    listenProgramAudio(station.id, res);
    let timer;
    function scheduleCheck() {
      if (!res.destroyed && !res.writableEnded) {
        timer = setTimeout(checkAccess, Math.max(0, Math.min(5000, expiresAt - Date.now())));
      }
    }
    async function checkAccess() {
      try {
        if (!await repository.findById(id, organizationId) || !canListen()) return res.end();
        scheduleCheck();
      } catch {
        res.end();
      }
    }
    scheduleCheck();
    res.once('close', () => clearTimeout(timer));
  } catch (error) { next(error); }
}

export async function createPlaybackLink(req, res, next) {
  try {
    const { id } = req.params;
    const { id: userId, organizationId, sessionId } = req.user;
    const station = await RepositoryFactory.getStationRepository().findById(id, organizationId);
    if (!station) return res.sendStatus(404);
    const status = programStatus(id);
    if (!programHlsDirectory(id, status.session, 'index.m3u8')) return res.sendStatus(409);

    const ticket = CryptoService.signPlaybackToken({ stationId: id, programSession: status.session, userId, sessionId });
    const path = '/api/v1/stations/' + encodeURIComponent(id) + '/program/hls/' +
      encodeURIComponent(status.session) + '/play/' + ticket + '/index.m3u8';
    res.json({ success: true, data: { path } });
  } catch (error) { next(error); }
}

export function authorizePlayback(req, res, next) {
  const { id, session, ticket } = req.params;
  if (ticket.length > 1024) return res.sendStatus(401);
  let claims;
  try {
    claims = CryptoService.verifyPlaybackToken(ticket);
  } catch {
    return res.sendStatus(401);
  }
  if (claims.stationId !== id || claims.programSession !== session) return res.sendStatus(404);

  const user = activeSessionUser(claims.sid, claims.sub);
  if (!user || !hasPermission(user.role, 'iptv:manage')) return res.sendStatus(401);
  req.user = user;
  next();
}

export async function independentHls(req, res, next) {
  try {
    const { id, session, filename } = req.params;
    const station = await RepositoryFactory.getStationRepository().findById(id, req.user.organizationId);
    const root = station && programHlsDirectory(id, session, filename);
    if (!root) return res.sendStatus(404);
    res.set('Content-Type', filename.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t');
    res.sendFile(filename, { root, dotfiles: 'deny', cacheControl: false, lastModified: false }, error => {
      if (!error || res.destroyed) return;
      if (res.headersSent) return res.destroy();
      res.removeHeader('Content-Type');
      if (error.status === 404 || error.code === 'ENOENT') return res.sendStatus(404);
      next(error);
    });
  } catch (error) { next(error); }
}

export function configureIndependentProgram(req, res, next) {
  try {
    res.json({ success: true, data: selectProgramStation(req.params.id, req.user) });
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
