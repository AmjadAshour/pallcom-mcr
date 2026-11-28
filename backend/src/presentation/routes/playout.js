import { Router } from 'express';
import { z } from 'zod';
import { RepositoryFactory } from '../../infrastructure/repositories/repository-factory.js';
import { agentGateway } from '../../infrastructure/agent/agent-gateway.js';
import { playoutCategories as categories } from '@mcr/shared';
import { readAsRun, readPlayoutAssets, savePlayoutAssets, stationPlayout } from '../../infrastructure/playout/engine.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { authorize } from '../middlewares/rbac.middleware.js';
import { validateBody } from '../middlewares/validate.middleware.js';

export const playoutRouter = Router();
const root = '/stations/:id/playout';
const name = z.string().trim().min(1).max(250);
const item = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('media'), id: z.string().uuid(), title: name, category: z.enum(categories.slice(0, -1)),
    durationMs: z.number().int().min(1).max(86400000), assetId: z.string().regex(/^[a-f0-9]{16}:[\w-]{1,1600}$/),
    hardStartAt: z.number().int().min(0).max(4102444800000).nullable()
  }).strict(),
  z.object({
    kind: z.literal('live'), id: z.string().uuid(), title: name, category: z.literal('live'),
    sceneName: name, durationMs: z.number().int().min(1000).max(86400000),
    hardStartAt: z.number().int().min(0).max(4102444800000).nullable()
  }).strict()
]);
const optionalSource = z.string().trim().max(250);
const planSchema = z.object({
  revision: z.number().int().nonnegative(), items: z.array(item).max(150), filler: z.array(item).max(50),
  loop: z.boolean(), decks: z.array(z.object({ sceneName: name, inputName: name }).strict()).max(2),
  backupScene: optionalSource,
  graphics: z.object({
    logoSource: optionalSource, lowerThirdSource: optionalSource, tickerSource: optionalSource,
    logo: z.boolean(), lowerThird: z.boolean(), ticker: z.boolean(), hideLogoDuringAds: z.boolean()
  }).strict()
}).strict().superRefine((plan, context) => {
  const addError = (message) => context.addIssue({ code: z.ZodIssueCode.custom, message });
  const all = [...plan.items, ...plan.filler];
  if (new Set(all.map((entry) => entry.id)).size !== all.length) addError('Playlist item IDs must be distinct');
  const pins = plan.items.filter((entry) => entry.hardStartAt !== null).map((entry) => entry.hardStartAt);
  if (new Set(pins).size !== pins.length) addError('Two items cannot have the same fixed start');
  if (pins.some((time, index) => index > 0 && time < pins[index - 1])) addError('Keep fixed starts in chronological order');
  if (plan.decks.length && (plan.decks.length !== 2 || plan.decks[0].sceneName === plan.decks[1].sceneName ||
    plan.decks[0].inputName === plan.decks[1].inputName)) addError('Use two different OBS deck scenes and Media Sources');
  if (plan.filler.some((entry) => entry.hardStartAt !== null || entry.kind !== 'media')) addError('Fallback accepts unpinned media only');
});

function withStation(handler) {
  return async (req, res, next) => {
    try {
      const station = await RepositoryFactory.getStationRepository().findById(req.params.id, req.user.organizationId);
      if (!station) return res.status(404).json({ success: false, error: 'Station not found' });
      const data = await handler(req, station);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  };
}

function badRequest(error) {
  return Object.assign(new Error(error), { statusCode: 400 });
}

playoutRouter.get(root, authenticate, authorize('station:read'), withStation((req, station) =>
  stationPlayout(station.id).snapshot()));

playoutRouter.put(root, authenticate, authorize('schedule:publish'), validateBody(planSchema), withStation(async (req, station) => {
  const engine = stationPlayout(station.id);
  const previous = engine.plan;
  const knownAssets = new Map([...previous.items, ...previous.filler, ...readPlayoutAssets(station.id)]
    .filter((asset) => asset.assetId && asset.durationMs).map((asset) => [asset.assetId, asset.durationMs]));
  function normalize(entry) {
    if (entry.hardStartAt !== null && entry.hardStartAt < Date.now() &&
      !previous.items.some((old) => old.id === entry.id && old.hardStartAt === entry.hardStartAt)) {
      throw badRequest('A new fixed start must be in the future');
    }
    if (entry.kind === 'live') return entry;
    const durationMs = knownAssets.get(entry.assetId);
    if (!durationMs) throw badRequest('Scan this asset before adding it to the playlist');
    return { ...entry, durationMs };
  }
  const snapshot = await engine.savePlan({ ...req.body, items: req.body.items.map(normalize), filler: req.body.filler.map(normalize) });
  await RepositoryFactory.getAuditRepository().create({
    organizationId: req.user.organizationId,
    userId: req.user.id,
    action: 'PLAYOUT_PLAN_SAVED',
    resourceType: 'Station',
    resourceId: station.id,
    details: { revision: snapshot.plan.revision },
    ipAddress: req.ip
  });
  return snapshot;
}));

playoutRouter.get(root + '/assets', authenticate, authorize('station:read'), withStation((req, station) =>
  readPlayoutAssets(station.id)));
playoutRouter.post(root + '/scan', authenticate, authorize('station:control'), withStation(async (req, station) => {
  const result = await agentGateway.sendCommand(station.id, 'ScanPlayoutMedia', {}, 480000);
  if (!await RepositoryFactory.getStationRepository().findById(station.id, station.organizationId)) {
    throw Object.assign(new Error('Station no longer exists'), { statusCode: 404 });
  }
  savePlayoutAssets(station.id, result.assets);
  await RepositoryFactory.getAuditRepository().create({
    organizationId: req.user.organizationId,
    userId: req.user.id,
    action: 'PLAYOUT_MEDIA_SCANNED',
    resourceType: 'Station',
    resourceId: station.id,
    details: { count: result.assets.length, truncated: Boolean(result.truncated) },
    ipAddress: req.ip
  });
  return result;
}));
playoutRouter.post(root + '/health', authenticate, authorize('station:control'), validateBody(z.object({
  assetIds: z.array(z.string().regex(/^[a-f0-9]{16}:[\w-]{1,1600}$/)).max(200)
}).strict()), withStation((req, station) => agentGateway.sendCommand(station.id, 'CheckPlayoutMedia', req.body, 200000)));

playoutRouter.get(root + '/as-run', authenticate, authorize('station:read'), withStation((req, station) =>
  readAsRun(station.id)));

const controlSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('start') }).strict(),
  z.object({ action: z.literal('release') }).strict(),
  z.object({ action: z.literal('skip') }).strict(),
  z.object({ action: z.literal('restart') }).strict(),
  z.object({ action: z.literal('emergency'), sceneName: name.optional() }).strict(),
  z.object({ action: z.literal('overlay'), overlay: z.enum(['logo', 'lowerThird', 'ticker']), enabled: z.boolean() }).strict()
]);
playoutRouter.post(root + '/control', authenticate, authorize('station:control'), validateBody(controlSchema),
  (req, res, next) => {
    if (req.body.action === 'emergency') return authorize('broadcast:emergency')(req, res, next);
    if (req.body.action === 'overlay') return authorize('graphics:manage')(req, res, next);
    next();
  },
  withStation(async (req, station) => {
    const snapshot = await stationPlayout(station.id).control(req.body.action, req.body);
    await RepositoryFactory.getAuditRepository().create({
      organizationId: req.user.organizationId,
      userId: req.user.id,
      action: 'PLAYOUT_CONTROL',
      resourceType: 'Station',
      resourceId: station.id,
      details: {
        action: req.body.action,
        ...(req.body.overlay && { overlay: req.body.overlay, enabled: req.body.enabled })
      },
      ipAddress: req.ip
    });
    return snapshot;
  }));
