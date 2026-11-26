import { z } from 'zod';
import { AutomationController } from '../controllers/automation.controller.js';
import { independentMonitor, independentProgram } from '../controllers/program.controller.js';
import { RepositoryFactory } from '../../infrastructure/repositories/repository-factory.js';
import { CryptoService } from '../../infrastructure/security/crypto-service.js';
import { Router } from 'express';
import { AuthController } from '../controllers/auth.controller.js';
import { StationController } from '../controllers/station.controller.js';
import { ObsController } from '../controllers/obs.controller.js';
import { PairingController } from '../controllers/pairing.controller.js';
import { AuditController } from '../controllers/audit.controller.js';

import { authenticate } from '../middlewares/auth.middleware.js';
import { authorize } from '../middlewares/rbac.middleware.js';
import { validateBody } from '../middlewares/validate.middleware.js';
import { accountLoginLimiter, authLimiter } from '../middlewares/rate-limiter.middleware.js';

import {
  LoginSchema,
  CreateStationSchema,
  UpdateStationSchema,
  SceneSwitchSchema,
  AudioVolumeSchema,
  AudioMuteSchema
} from '@mcr/validation';

export const apiRouter = Router();

// Authentication Endpoints
apiRouter.post('/auth/login', authLimiter, validateBody(LoginSchema), accountLoginLimiter, AuthController.login);
apiRouter.post('/auth/refresh', AuthController.refresh);
apiRouter.post('/auth/logout', AuthController.logout);
apiRouter.get('/auth/me', authenticate, AuthController.me);
apiRouter.get('/users', authenticate, authorize('user:manage'), async (req, res, next) => {
  try {
    const data = await RepositoryFactory.getUserRepository().listByOrganization(req.user.organizationId);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});
apiRouter.post('/users', authenticate, authorize('user:manage'), validateBody(z.object({
  fullName: z.string().trim().min(2).max(120), email: z.string().email(),
  password: z.string().min(12).max(128), role: z.enum(['STUDIO_MANAGER', 'OPERATOR', 'VIEWER'])
})), async (req, res, next) => {
  try {
    const { password, ...values } = req.body;
    const repository = RepositoryFactory.getUserRepository();
    if (await repository.findByEmail(values.email)) return res.status(409).json({ success: false, error: 'Email is already registered' });
    const passwordHash = await CryptoService.hashPassword(password);
    await repository.create({ ...values, passwordHash, organizationId: req.user.organizationId });
    res.status(201).json({ success: true });
  } catch (error) {
    next(error);
  }
});

// Station Management Endpoints (RBAC protected)
apiRouter.get('/stations', authenticate, authorize('station:read'), StationController.list);
apiRouter.get('/stations/:id', authenticate, authorize('station:read'), StationController.get);
apiRouter.post('/stations', authenticate, authorize('station:manage'), validateBody(CreateStationSchema), StationController.create);
apiRouter.patch('/stations/:id', authenticate, authorize('station:manage'), validateBody(UpdateStationSchema), StationController.update);
apiRouter.delete('/stations/:id', authenticate, authorize('station:manage'), StationController.delete);

// OBS Control Endpoints (RBAC protected)
apiRouter.get('/stations/:id/program', authenticate, authorize('station:read'), independentProgram);
apiRouter.get(['/stations/:id/program/input-preview', '/stations/:id/program/program-monitor'],
  authenticate, authorize('station:read'), independentMonitor);
apiRouter.post('/stations/:id/program', authenticate, authorize('station:control'),
  validateBody(z.union([
    z.object({ action: z.enum(['start', 'stop', 'obs', 'obs2', 'fallback', 'mute', 'unmute']) }).strict(),
    z.object({ action: z.literal('gain'), gainDb: z.number().int().min(-30).max(0) }).strict()
  ])), independentProgram);
apiRouter.get('/stations/:id/scenes', authenticate, authorize('station:read'), ObsController.getScenes);
apiRouter.get('/stations/:id/snapshot', authenticate, authorize('station:read'), ObsController.stationCommand('GetStationSnapshot'));
apiRouter.get('/stations/:id/preview-image', authenticate, authorize('station:read'),
  ObsController.stationCommand('GetSceneScreenshot', (req) => ({ preview: req.query.bus === 'preview' })));
apiRouter.post('/stations/:id/scene-item', authenticate, authorize('station:control'),
  validateBody(z.object({ sceneName: z.string().min(1), sceneItemId: z.number().int(), enabled: z.boolean() })),
  ObsController.stationCommand('SetSceneItemEnabled', (req) => req.body));
apiRouter.post('/stations/:id/studio-mode/t-bar', authenticate, authorize('station:control'),
  validateBody(z.object({ position: z.number().min(0).max(1), release: z.boolean() })),
  ObsController.stationCommand('SetTBarPosition', (req) => req.body));
apiRouter.post('/stations/:id/studio-mode', authenticate, authorize('station:control'),
  validateBody(z.object({ enabled: z.boolean() })),
  ObsController.stationCommand('SetStudioModeEnabled', (req) => req.body));
apiRouter.post('/stations/:id/transition-type', authenticate, authorize('station:control'),
  validateBody(z.object({ transitionName: z.string().min(1).max(250) })),
  ObsController.stationCommand('SetCurrentSceneTransition', (req) => req.body));
apiRouter.post('/stations/:id/transition-duration', authenticate, authorize('station:control'),
  validateBody(z.object({ transitionDuration: z.number().int().min(50).max(20000) })),
  ObsController.stationCommand('SetCurrentSceneTransitionDuration', (req) => req.body));
apiRouter.post('/stations/:id/text-input', authenticate, authorize('station:control'),
  validateBody(z.object({ inputName: z.string().min(1).max(250), text: z.string().max(3000) })),
  ObsController.stationCommand('SetTextInput', (req) => req.body));
apiRouter.post('/stations/:id/scenes/switch', authenticate, authorize('station:control'), validateBody(SceneSwitchSchema), ObsController.switchScene);
apiRouter.post('/stations/:id/scenes/cut', authenticate, authorize('station:control'),
  validateBody(z.object({ sceneName: z.string().min(1).max(250) })),
  ObsController.stationCommand('CutToScene', (req) => req.body));
apiRouter.post('/stations/:id/stream/start', authenticate, authorize('station:control'), ObsController.startStream);
apiRouter.post('/stations/:id/stream/stop', authenticate, authorize('station:control'), ObsController.stopStream);
apiRouter.post('/stations/:id/record/start', authenticate, authorize('station:control'), ObsController.startRecord);
apiRouter.post('/stations/:id/record/stop', authenticate, authorize('station:control'), ObsController.stopRecord);
for (const [action, command] of Object.entries({
  start: 'StartReplayBuffer', stop: 'StopReplayBuffer', save: 'SaveReplayBuffer'
})) {
  apiRouter.post('/stations/:id/replay/' + action, authenticate, authorize('station:control'), ObsController.stationCommand(command));
}
apiRouter.post('/stations/:id/audio/volume', authenticate, authorize('station:control'), validateBody(AudioVolumeSchema), ObsController.setVolume);
apiRouter.post('/stations/:id/audio/mute', authenticate, authorize('station:control'), validateBody(AudioMuteSchema), ObsController.setMute);
apiRouter.post('/stations/:id/studio-mode/transition', authenticate, authorize('station:control'), ObsController.triggerStudioTransition);

// Device Pairing Endpoints
apiRouter.post('/pairing/generate', authenticate, authorize('station:manage'),
  validateBody(z.object({ stationId: z.string().min(1).max(100) }).strict()), PairingController.generate);
apiRouter.post('/pairing/claim', authLimiter, validateBody(z.object({
  pairingCode: z.string().regex(/^MCR-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/),
  machineHostname: z.string().max(255).optional(), osPlatform: z.string().max(64).optional(),
  agentVersion: z.string().max(64).optional()
}).strict()), PairingController.claim);
apiRouter.post('/stations/:id/agent/revoke', authenticate, authorize('station:manage'), PairingController.revoke);

// Audit Logs
apiRouter.get('/logs', authenticate, authorize('audit:read'), AuditController.list);


const automationSchema = z.object({
  stationId: z.string().min(1), name: z.string().trim().min(1).max(100),
  action: z.enum(['scene', 'recordingStart', 'recordingStop']),
  sceneName: z.string().min(1).max(250).optional(), runAt: z.string().datetime().optional()
}).refine((job) => job.action !== 'scene' || Boolean(job.sceneName), 'Choose a scene');

apiRouter.get('/automations', authenticate, authorize('station:control'), AutomationController.list);
apiRouter.post('/automations', authenticate, authorize('station:control'), validateBody(automationSchema), AutomationController.create);
apiRouter.post('/automations/:id/run', authenticate, authorize('station:control'), AutomationController.run);
apiRouter.post('/automations/:id/cancel', authenticate, authorize('station:control'), AutomationController.cancel);
