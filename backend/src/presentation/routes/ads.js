import { Router, raw } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { scheduledInstant, transportAction } from '@mcr/shared';
import { authenticate } from '../middlewares/auth.middleware.js';
import { authorize } from '../middlewares/rbac.middleware.js';
import { validateBody } from '../middlewares/validate.middleware.js';
import { getSqliteDatabase } from '../../infrastructure/database/sqlite.js';
import { insertAuditEvent } from '../../infrastructure/repositories/sqlite-audit-repository.js';
import { adPlan, applyPlacements, runtimeNow } from '../../infrastructure/program/ads.js';
import { prepareCreative } from '../../infrastructure/program/ad-creatives.js';
import { configured, updateAds } from '../../infrastructure/program/supervisor.js';

export const adsRouter = Router();
const root = '/stations/:id/program/ads';
const pct = z.number().min(0).max(100);
const ms = z.number().int().min(0).max(86400000);
const delta = z.number().min(-100).max(100);
const civil = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
  .or(z.literal(''));
const item = z
  .object({
    asset: z.string().uuid(),
    duration: ms.min(200),
    gap: ms,
    enter: ms,
    exit: ms,
    dx: delta,
    dy: delta,
    startLocal: civil.optional(),
    endLocal: civil.optional()
  })
  .strict()
  .refine((a) => a.enter + a.exit <= a.duration, 'Fades must fit inside the display duration');
const placement = z
  .object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(80),
    enabled: z.boolean(),
    x: pct,
    y: pct,
    w: pct.min(1),
    h: pct.min(1),
    z: z.number().int().min(0).max(999),
    startLocal: civil,
    endLocal: civil,
    items: z.array(item).max(40)
  })
  .strict()
  .refine((p) => p.w + p.x <= 100 && p.y + p.h <= 100, 'Placement extends outside canvas');
const rev = z.number().int().nonnegative();
const schema = z
  .object({ revision: rev, zone: z.string().min(1).max(80), placements: z.array(placement).max(4) })
  .strict();
const prepares = new Set();
const db = getSqliteDatabase;
const library = (id) =>
  db().prepare('SELECT id,name,kind,frames FROM ad_assets WHERE stationId=? ORDER BY name,id').all(id);
const owns = (req) =>
  configured(req.params.id) &&
  db()
    .prepare('SELECT 1 FROM stations WHERE id=? AND organizationId=?')
    .get(req.params.id, req.user.organizationId);
function audit(req, action, details) {
  insertAuditEvent(db(), {
    organizationId: req.user.organizationId,
    userId: req.user.id,
    action,
    resourceType: 'Station',
    resourceId: req.params.id,
    details
  });
}
function transaction(work) {
  db().exec('BEGIN IMMEDIATE');
  try {
    const value = work();
    db().exec('COMMIT');
    return value;
  } catch (error) {
    db().exec('ROLLBACK');
    throw error;
  }
}
function fail(message, statusCode = 400) {
  throw Object.assign(new Error(message), { statusCode });
}
function resolveWindow(entry, zone) {
  let start, end;
  try {
    start = scheduledInstant(entry.startLocal, zone);
    end = scheduledInstant(entry.endLocal, zone);
  } catch (error) {
    fail(error.message);
  }
  if (start !== null && end !== null && end <= start) fail('Schedule end must follow start');
  return { ...entry, start, end };
}
function current(req) {
  const plan = adPlan(req.params.id);
  if (plan.revision !== req.body.revision) fail('Ad plan changed. Reload before applying.', 409);
  return plan;
}
function save(req, plan, action, details) {
  db()
    .prepare('INSERT OR REPLACE INTO program_ads(stationId,plan) VALUES (?,?)')
    .run(req.params.id, JSON.stringify(plan));
  audit(req, action, { ...details, revision: plan.revision });
}
adsRouter.use(root, authenticate, authorize('station:control'), (req, res, next) => {
  if (!owns(req)) return res.sendStatus(404);
  res.set('Cache-Control', 'private, no-store');
  next();
});
adsRouter.get(root, (req, res) =>
  res.json({ success: true, data: { plan: adPlan(req.params.id), assets: library(req.params.id) } })
);
adsRouter.get(root + '/assets/:asset/media', (req, res) => {
  const row = db()
    .prepare('SELECT kind,media FROM ad_assets WHERE stationId=? AND id=?')
    .get(req.params.id, req.params.asset);
  if (!row) return res.sendStatus(404);
  res.type(row.kind === 'image' ? 'image/png' : 'video/mp4').send(Buffer.from(row.media));
});
adsRouter.post(
  root + '/assets',
  raw({ type: ['image/png', 'image/jpeg', 'image/webp', 'video/mp4'], limit: '12mb' }),
  async (req, res, next) => {
    const id = req.params.id;
    let locked = false;
    try {
      const name = z.string().trim().min(1).max(100).safeParse(req.query.name);
      if (!name.success || !Buffer.isBuffer(req.body)) fail('Choose a named PNG, JPEG, WebP or MP4');
      if (prepares.has(id) || library(id).length >= 32) fail('Library is busy or full (32 creatives)', 409);
      prepares.add(id);
      locked = true;
      let prepared;
      try {
        prepared = await prepareCreative(req.body, req.get('Content-Type').split(';')[0]);
      } catch (error) {
        if (error.code === 'ENOENT') fail('FFmpeg is unavailable on the media host', 503);
        fail('Unreadable image or MP4; video limit is 30 seconds');
      }
      if (!owns(req)) return res.sendStatus(404);
      const asset = randomUUID();
      transaction(() => {
        db()
          .prepare('INSERT INTO ad_assets VALUES (?,?,?,?,?,?)')
          .run(id, asset, name.data, prepared.kind, prepared.frames.length, prepared.media);
        const insert = db().prepare('INSERT INTO ad_frames VALUES (?,?,?,?)');
        prepared.frames.forEach((frame, index) => insert.run(id, asset, index, frame));
        audit(req, 'AD_ASSET_ADD', { asset });
      });
      res
        .status(201)
        .json({
          success: true,
          data: { id: asset, name: name.data, kind: prepared.kind, frames: prepared.frames.length }
        });
    } catch (error) {
      next(error);
    } finally {
      if (locked) prepares.delete(id);
    }
  }
);
adsRouter.delete(root + '/assets/:asset', (req, res) => {
  const id = req.params.id,
    asset = req.params.asset;
  transaction(() => {
    if (adPlan(id).placements.some((p) => p.items.some((i) => i.asset === asset)))
      fail('Creative is assigned to Program', 409);
    if (!db().prepare('DELETE FROM ad_assets WHERE stationId=? AND id=?').run(id, asset).changes)
      fail('Creative unavailable', 404);
    db().prepare('DELETE FROM ad_frames WHERE stationId=? AND asset=?').run(id, asset);
    audit(req, 'AD_ASSET_REMOVE', { asset });
  });
  res.json({ success: true });
});
adsRouter.put(root, validateBody(schema), (req, res) => {
  const plan = transaction(() => {
    const previous = current(req);
    const { zone, placements } = req.body;
    const available = new Set(library(req.params.id).map((a) => a.id));
    if (new Set(placements.map((p) => p.id)).size !== placements.length) fail('Duplicate placement');
    try {
      new Intl.DateTimeFormat('en', { timeZone: zone });
    } catch {
      fail('Unknown IANA time zone');
    }
    const resolved = placements.map((p) => {
      if (p.items.some((i) => !available.has(i.asset))) fail('Creative unavailable');
      return { ...resolveWindow(p, zone), items: p.items.map((entry) => resolveWindow(entry, zone)) };
    });
    const plan = applyPlacements(previous, resolved, zone);
    save(req, plan, 'AD_PLAN_APPLY', {});
    return plan;
  });
  updateAds(plan);
  res.json({ success: true, data: plan });
});
adsRouter.post(
  root + '/control',
  validateBody(
    z
      .object({
        id: z.string().uuid(),
        revision: rev,
        action: z.enum(['pause', 'resume', 'skip', 'disable'])
      })
      .strict()
  ),
  (req, res) => {
    const plan = transaction(() => {
      const plan = current(req);
      const { id, action } = req.body;
      const p = plan.placements.find((p) => p.id === id);
      if (!p) fail('Placement unavailable', 404);
      plan.transport[id] = transportAction(p, plan.transport[id], action, runtimeNow());
      if (action === 'disable') p.enabled = false;
      plan.revision++;
      save(req, plan, 'AD_PLACEMENT_CONTROL', { id, action });
      return plan;
    });
    updateAds(plan);
    res.json({ success: true, data: plan });
  }
);
