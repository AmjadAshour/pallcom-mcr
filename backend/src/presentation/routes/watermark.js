import { Router } from 'express';
import { z } from 'zod';
import { PROGRAM_CANVAS } from '@mcr/shared';
import { authenticate } from '../middlewares/auth.middleware.js';
import { authorize } from '../middlewares/rbac.middleware.js';
import { validateBody } from '../middlewares/validate.middleware.js';
import { decodeImage } from './graphics.js';
import { getSqliteDatabase } from '../../infrastructure/database/sqlite.js';
import { insertAuditEvent } from '../../infrastructure/repositories/sqlite-audit-repository.js';
import { configured, updateWatermark, previewFrame } from '../../infrastructure/program/supervisor.js';
import { defaultWatermark, renderWatermark } from '../../infrastructure/program/watermark.js';

export const watermarkRouter = Router();
const root = '/stations/:id/program/watermark';
const schema = z.object({
  revision: z.number().int().nonnegative(), enabled: z.boolean(), image: z.string().max(700000),
  anchor: z.enum(['top-left', 'top-right', 'bottom-left', 'bottom-right']),
  x: z.number().min(0).max(95), y: z.number().min(0).max(95),
  size: z.number().min(1).max(100), opacity: z.number().min(0).max(100)
}).strict();
function ownsStation(req) {
  return configured(req.params.id) && getSqliteDatabase().prepare('SELECT 1 FROM stations WHERE id=? AND organizationId=?')
    .get(req.params.id, req.user.organizationId);
}
watermarkRouter.use(root, authenticate, authorize('graphics:manage'), (req, res, next) => {
  if (!ownsStation(req)) return res.sendStatus(404);
  res.set('Cache-Control', 'no-store');
  next();
});
watermarkRouter.get(root, (req, res) => {
  const db = getSqliteDatabase();
  const row = db.prepare('SELECT settings, revision FROM program_watermarks WHERE stationId=?').get(req.params.id);
  const logo = db.prepare("SELECT image FROM station_graphics WHERE stationId=? AND kind='logo'").get(req.params.id);
  res.json({ success: true, data: { settings: row ? JSON.parse(row.settings) : defaultWatermark,
    revision: row?.revision ?? 0, stationLogo: logo?.image ?? '', canvas: PROGRAM_CANVAS } });
});
watermarkRouter.get(root + '/preview', (req, res) => res.json({ success: true, data: previewFrame() }));
watermarkRouter.put(root, validateBody(schema), async (req, res, next) => {
  try {
    const { revision, ...settings } = req.body;
    const image = decodeImage(settings.image);
    if ((settings.enabled || settings.image) && !image) return res.status(400).json({ success: false, error: 'Choose a valid logo' });
    let bitmap;
    try { bitmap = await renderWatermark(settings, image); }
    catch { return res.status(400).json({ success: false, error: 'Use a single-frame PNG, JPEG or WebP up to 512 KB' }); }
    if (!ownsStation(req)) return res.sendStatus(404);
    const db = getSqliteDatabase();
    const id = req.params.id;
    db.exec('BEGIN IMMEDIATE');
    try {
      const row = db.prepare('SELECT revision FROM program_watermarks WHERE stationId=?').get(id);
      if ((row?.revision ?? 0) !== revision) {
        db.exec('ROLLBACK');
        return res.status(409).json({ success: false, error: 'Watermark changed. Reload the saved settings before applying.' });
      }
      db.prepare('INSERT OR REPLACE INTO program_watermarks (stationId, revision, settings, bitmap) VALUES (?, ?, ?, ?)')
        .run(id, revision + 1, JSON.stringify(settings), bitmap);
      insertAuditEvent(db, { organizationId: req.user.organizationId, userId: req.user.id,
        action: 'PROGRAM_WATERMARK_APPLY', resourceType: 'Station', resourceId: id, details: { revision: revision + 1, enabled: settings.enabled } });
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    updateWatermark({ revision: revision + 1, bitmap });
    res.json({ success: true, revision: revision + 1 });
  } catch (error) { next(error); }
});
