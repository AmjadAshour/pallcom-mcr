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
  }),
  z.object({
    kind: z.literal('live'), id: z.string().uuid(), title: name, category: z.literal('live'),
    sceneName: name, durationMs: z.number().int().min(1000).max(86400000),
    hardStartAt: z.number().int().min(0).max(4102444800000).nullable()
  })
]);
const optionalSource = z.string().trim().max(250);
const planSchema = z.object({
  revision: z.number().int().nonnegative(), items: z.array(item).max(150), filler: z.array(item).max(50),
  loop: z.boolean(), decks: z.array(z.object({ sceneName: name, inputName: name })).max(2),
  backupScene: optionalSource,
  graphics: z.object({
    logoSource: optionalSource, lowerThirdSource: optionalSource, tickerSource: optionalSource,
    logo: z.boolean(), lowerThird: z.boolean(), ticker: z.boolean(), hideLogoDuringAds: z.boolean()
  })
}).superRefine((plan, context) => {
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

playoutRouter.put(root, authenticate, authorize('station:control'), validateBody(planSchema), withStation((req, station) => {
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
  return engine.savePlan({ ...req.body, items: req.body.items.map(normalize), filler: req.body.filler.map(normalize) });
}));

playoutRouter.get(root + '/assets', authenticate, authorize('station:read'), withStation((req, station) =>
  readPlayoutAssets(station.id)));
playoutRouter.post(root + '/scan', authenticate, authorize('station:control'), withStation(async (req, station) => {
  const result = await agentGateway.sendCommand(station.id, 'ScanPlayoutMedia', {}, 480000);
  if (!await RepositoryFactory.getStationRepository().findById(station.id, station.organizationId)) {
    throw Object.assign(new Error('Station no longer exists'), { statusCode: 404 });
  }
  savePlayoutAssets(station.id, result.assets);
  return result;
}));
playoutRouter.post(root + '/health', authenticate, authorize('station:control'), validateBody(z.object({
  assetIds: z.array(z.string().regex(/^[a-f0-9]{16}:[\w-]{1,1600}$/)).max(200)
})), withStation((req, station) => agentGateway.sendCommand(station.id, 'CheckPlayoutMedia', req.body, 200000)));

playoutRouter.get(root + '/as-run', authenticate, authorize('station:read'), withStation((req, station) =>
  readAsRun(station.id)));

const controlSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('start') }),
  z.object({ action: z.literal('release') }),
  z.object({ action: z.literal('skip') }),
  z.object({ action: z.literal('restart') }),
  z.object({ action: z.literal('emergency'), sceneName: name.optional() }),
  z.object({ action: z.literal('overlay'), overlay: z.enum(['logo', 'lowerThird', 'ticker']), enabled: z.boolean() })
]);
playoutRouter.post(root + '/control', authenticate, authorize('station:control'), validateBody(controlSchema),
  withStation((req, station) => stationPlayout(station.id).control(req.body.action, req.body)));
