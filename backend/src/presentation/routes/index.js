import { z } from 'zod';
import { AutomationController } from '../controllers/automation.controller.js';
import { authorizePlayback, configureIndependentProgram, createPlaybackLink, independentAudioMonitor, independentHls, independentMonitor, independentProgram, reportProgramReceiver } from '../controllers/program.controller.js';
import { programInputAudioSchema } from '../../infrastructure/program/supervisor.js';
import { RepositoryFactory } from '../../infrastructure/repositories/repository-factory.js';
import { CryptoService } from '../../infrastructure/security/crypto-service.js';
import { managedAccountRoles } from '../../infrastructure/security/account-management.js';
import { Router } from 'express';
import { AuthController } from '../controllers/auth.controller.js';
import { StationController } from '../controllers/station.controller.js';
import { ObsController } from '../controllers/obs.controller.js';
import { PairingController } from '../controllers/pairing.controller.js';
import { AuditController } from '../controllers/audit.controller.js';

import { authenticate } from '../middlewares/auth.middleware.js';
import { authorize } from '../middlewares/rbac.middleware.js';
import { validateBody } from '../middlewares/validate.middleware.js';
import { accountChangeLimiter, accountLoginLimiter, authLimiter, emailRecoveryLimiter, pairingClaimLimiter,
  passwordRecoveryLimiter, passwordResetLimiter } from '../middlewares/rate-limiter.middleware.js';

import {
  LoginSchema,
  SecondFactorSchema,
  CreateStationSchema,
  UpdateStationSchema,
  SceneSwitchSchema,
  AudioVolumeSchema,
  AudioMuteSchema
} from '@mcr/validation';

export const apiRouter = Router();

apiRouter.use(['/auth', '/users', '/logs'], (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

// Authentication Endpoints
apiRouter.post('/auth/login', authLimiter, validateBody(LoginSchema), accountLoginLimiter, AuthController.login);
apiRouter.post('/auth/refresh', AuthController.refresh);
apiRouter.post('/auth/logout', AuthController.logout);
apiRouter.get('/auth/me', authenticate, AuthController.me);
const fullName = z.string().trim().min(2).max(120);
const currentPassword = z.string().min(1).max(4096);
const newPassword = z.string().min(12).max(128);
apiRouter.get('/auth/recovery', AuthController.recovery);
apiRouter.post('/auth/password/forgot', passwordRecoveryLimiter, validateBody(z.object({
  email: z.string().trim().max(254).email()
}).strict()), emailRecoveryLimiter, AuthController.forgotPassword);
apiRouter.post('/auth/password/reset', passwordResetLimiter, validateBody(z.object({
  token: z.string().regex(/^[a-zA-Z0-9_-]{43}$/), newPassword
}).strict()), AuthController.resetPassword);
apiRouter.patch('/auth/me', authenticate, validateBody(z.object({ fullName }).strict()), AuthController.profile);
apiRouter.post('/auth/password', authenticate, accountChangeLimiter, validateBody(z.object({
  currentPassword, newPassword
}).strict()), AuthController.password);
apiRouter.get('/auth/sessions', authenticate, AuthController.sessions);
apiRouter.delete('/auth/sessions/:id', authenticate, AuthController.revoke);
apiRouter.get('/auth/mfa', authenticate, AuthController.twoFactor);
apiRouter.post('/auth/mfa/enroll', authenticate, accountChangeLimiter,
  validateBody(z.object({ currentPassword }).strict()), AuthController.beginTwoFactor);
apiRouter.post('/auth/mfa/confirm', authenticate, accountChangeLimiter,
  validateBody(z.object({ currentPassword, secondFactor: z.string().regex(/^\d{6}$/) }).strict()), AuthController.confirmTwoFactor);
apiRouter.post('/auth/mfa/disable', authenticate, accountChangeLimiter,
  validateBody(z.object({ currentPassword, secondFactor: SecondFactorSchema }).strict()), AuthController.disableTwoFactor);
apiRouter.patch('/users/:id/status', authenticate, authorize('user:manage'), accountChangeLimiter,
  validateBody(z.object({ currentPassword, active: z.boolean() }).strict()), AuthController.accountStatus);
apiRouter.patch('/users/:id/role', authenticate, authorize('user:manage'), accountChangeLimiter,
  validateBody(z.object({ currentPassword, role: z.enum(managedAccountRoles) }).strict()), AuthController.accountRole);
apiRouter.get('/users', authenticate, authorize('user:manage'), async (req, res, next) => {
  try {
    const data = await RepositoryFactory.getUserRepository().listByOrganization(req.user.organizationId);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});
apiRouter.post('/users', authenticate, authorize('user:manage'), accountChangeLimiter, validateBody(z.object({
  fullName, email: z.string().trim().max(254).email(),
  password: newPassword, role: z.enum(managedAccountRoles),
  currentPassword
}).strict()), async (req, res, next) => {
  try {
    const { password, currentPassword: suppliedCurrentPassword, ...values } = req.body;
    const repository = RepositoryFactory.getUserRepository();
    const actorUser = await repository.findByEmail(req.user.email);
    if (actorUser?.id !== req.user.id || !actorUser.isActive ||
        !await CryptoService.verifyPassword(actorUser.passwordHash, suppliedCurrentPassword)) {
      throw Object.assign(new Error('Current password is incorrect.'), { status: 403 });
    }
    if (await repository.findByEmail(values.email)) return res.status(409).json({ success: false, error: 'Email is already registered' });
    const passwordHash = await CryptoService.hashPassword(password);
    await repository.create({ ...values, passwordHash, organizationId: req.user.organizationId }, {
      actor: { id: req.user.id, sessionId: req.user.sessionId, ipAddress: req.ip, passwordHash: actorUser.passwordHash }
    });
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
apiRouter.put('/stations/:id/program/selection', authenticate, authorize('station:manage'), configureIndependentProgram);
apiRouter.get('/stations/:id/program', authenticate, authorize('station:read'), independentProgram);
apiRouter.post('/stations/:id/program/receivers/:destination',
  validateBody(z.object({ video: z.boolean(), audio: z.boolean() }).strict()), reportProgramReceiver);
apiRouter.get(['/stations/:id/program/input-preview', '/stations/:id/program/program-monitor'],
  authenticate, authorize('station:read'), independentMonitor);
apiRouter.get('/stations/:id/program/audio-monitor', authenticate, authorize('station:read'), independentAudioMonitor);
apiRouter.use('/stations/:id/program/hls', (_req, res, next) => {
  res.set({ 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' });
  next();
});
apiRouter.post('/stations/:id/program/hls/playback-link', authenticate, authorize('iptv:manage'), createPlaybackLink);
apiRouter.get('/stations/:id/program/hls/:session/play/:ticket/:filename', authorizePlayback, independentHls);
apiRouter.get('/stations/:id/program/hls/:session/:filename', authenticate, authorize('station:read'), independentHls);
apiRouter.post('/stations/:id/program', authenticate, authorize('station:control'),
  validateBody(z.union([
    z.object({ action: z.enum(['start', 'stop', 'obs', 'obs2', 'fallback', 'mute', 'unmute']) }).strict(),
    z.object({ action: z.literal('gain'), gainDb: z.number().int().min(-30).max(0) }).strict(),
    z.object({ action: z.literal('input-audio'), inputAudio: programInputAudioSchema }).strict()
  ])), (req, res, next) => {
    const { action } = req.body;
    if (action === 'fallback') return authorize('broadcast:emergency')(req, res, next);
    if (['gain', 'input-audio', 'mute', 'unmute'].includes(action)) return authorize('audio:manage')(req, res, next);
    next();
  }, independentProgram);
apiRouter.get('/stations/:id/scenes', authenticate, authorize('station:read'), ObsController.getScenes);
apiRouter.get('/stations/:id/snapshot', authenticate, authorize('station:read'), ObsController.stationCommand('GetStationSnapshot'));
apiRouter.get('/stations/:id/preview-image', authenticate, authorize('station:read'),
  ObsController.stationCommand('GetSceneScreenshot', (req) => ({ preview: req.query.bus === 'preview' })));
apiRouter.post('/stations/:id/scene-item', authenticate, authorize('station:control'),
  validateBody(z.object({ sceneName: z.string().min(1).max(250), sceneItemId: z.number().int(), enabled: z.boolean() }).strict()),
  ObsController.stationCommand('SetSceneItemEnabled', (req) => req.body));
apiRouter.post('/stations/:id/studio-mode/t-bar', authenticate, authorize('station:control'),
  validateBody(z.object({ position: z.number().min(0).max(1), release: z.boolean() }).strict()),
  ObsController.stationCommand('SetTBarPosition', (req) => req.body));
apiRouter.post('/stations/:id/studio-mode', authenticate, authorize('station:control'),
  validateBody(z.object({ enabled: z.boolean() }).strict()),
  ObsController.stationCommand('SetStudioModeEnabled', (req) => req.body));
apiRouter.post('/stations/:id/transition-type', authenticate, authorize('station:control'),
  validateBody(z.object({ transitionName: z.string().min(1).max(250) }).strict()),
  ObsController.stationCommand('SetCurrentSceneTransition', (req) => req.body));
apiRouter.post('/stations/:id/transition-duration', authenticate, authorize('station:control'),
  validateBody(z.object({ transitionDuration: z.number().int().min(50).max(20000) }).strict()),
  ObsController.stationCommand('SetCurrentSceneTransitionDuration', (req) => req.body));
apiRouter.post('/stations/:id/text-input', authenticate, authorize('station:control'),
  validateBody(z.object({ inputName: z.string().min(1).max(250), text: z.string().max(3000) }).strict()),
  ObsController.stationCommand('SetTextInput', (req) => req.body));
apiRouter.post('/stations/:id/scenes/switch', authenticate, authorize('station:control'), validateBody(SceneSwitchSchema), ObsController.switchScene);
apiRouter.post('/stations/:id/scenes/cut', authenticate, authorize('station:control'),
  validateBody(z.object({ sceneName: z.string().min(1).max(250) }).strict()),
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
apiRouter.post('/stations/:id/audio/volume', authenticate, authorize('audio:manage'), validateBody(AudioVolumeSchema), ObsController.setVolume);
apiRouter.post('/stations/:id/audio/mute', authenticate, authorize('audio:manage'), validateBody(AudioMuteSchema), ObsController.setMute);
apiRouter.post('/stations/:id/studio-mode/transition', authenticate, authorize('station:control'), ObsController.triggerStudioTransition);

// Device Pairing Endpoints
apiRouter.post('/pairing/generate', authenticate, authorize('station:manage'),
  validateBody(z.object({ stationId: z.string().min(1).max(100) }).strict()), PairingController.generate);
apiRouter.post('/pairing/claim', pairingClaimLimiter, validateBody(z.object({
  pairingCode: z.string().regex(/^MCR-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/),
  machineHostname: z.string().max(255).optional(), osPlatform: z.string().max(64).optional(),
  agentVersion: z.string().max(64).optional()
}).strict()), PairingController.claim);
apiRouter.post('/stations/:id/agent/revoke', authenticate, authorize('station:manage'), PairingController.revoke);

// Audit Logs
apiRouter.get('/logs', authenticate, authorize('audit:read'), AuditController.list);


const automationSchema = z.object({
  stationId: z.string().min(1).max(100), name: z.string().trim().min(1).max(100),
  action: z.enum(['scene', 'recordingStart', 'recordingStop']),
  sceneName: z.string().min(1).max(250).optional(), runAt: z.string().datetime().optional()
}).strict().refine((job) => job.action !== 'scene' || Boolean(job.sceneName), 'Choose a scene');

apiRouter.get('/automations', authenticate, authorize('station:control'), AutomationController.list);
apiRouter.post('/automations', authenticate, authorize('station:control'), validateBody(automationSchema), AutomationController.create);
apiRouter.post('/automations/:id/run', authenticate, authorize('station:control'), AutomationController.run);
apiRouter.post('/automations/:id/cancel', authenticate, authorize('station:control'), AutomationController.cancel);
