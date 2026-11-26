import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middlewares/auth.middleware.js';
import { authorize } from '../middlewares/rbac.middleware.js';
import { validateBody } from '../middlewares/validate.middleware.js';
import { getSqliteDatabase } from '../../infrastructure/database/sqlite.js';
import { insertAuditEvent } from '../../infrastructure/repositories/sqlite-audit-repository.js';
import { configured, updateTicker } from '../../infrastructure/program/supervisor.js';
import { renderTicker, storedTicker } from '../../infrastructure/program/ticker.js';

export const tickerRouter = Router();
const root = '/stations/:id/program/ticker';
const schema = z.object({
  revision: z.number().int().nonnegative(), enabled: z.boolean(),
  text: z.string().max(400).transform(text => text.replace(/\s+/gu, ' ').trim()),
  speed: z.number().int().min(40).max(360), direction: z.enum(['left', 'right'])
}).strict().refine(settings => !settings.enabled || Boolean(settings.text), { path: ['text'], message: 'Enter a headline' });

tickerRouter.use(root, authenticate, authorize('station:control'), (req, res, next) => {
  if (!configured(req.params.id) || !getSqliteDatabase().prepare('SELECT 1 FROM stations WHERE id=? AND organizationId=?')
    .get(req.params.id, req.user.organizationId)) return res.sendStatus(404);
  res.set('Cache-Control', 'no-store');
  next();
});

tickerRouter.get(root, (req, res) => {
  const { revision, settings } = storedTicker(req.params.id);
  res.json({ success: true, data: { revision, settings } });
});

tickerRouter.put(root, validateBody(schema), async (req, res, next) => {
  try {
    const { revision, ...settings } = req.body;
    const id = req.params.id;
    let bitmap;
    try { bitmap = await renderTicker(settings); }
    catch { return res.status(400).json({ success: false, error: 'The headline could not be rendered' }); }
    const db = getSqliteDatabase();
    db.exec('BEGIN IMMEDIATE');
    try {
      if (!db.prepare('SELECT 1 FROM stations WHERE id=? AND organizationId=?').get(id, req.user.organizationId)) {
        db.exec('ROLLBACK');
        return res.sendStatus(404);
      }
      if (storedTicker(id).revision !== revision) {
        db.exec('ROLLBACK');
        return res.status(409).json({ success: false, error: 'Ticker changed. Reload the saved settings before applying.' });
      }
      db.prepare('INSERT OR REPLACE INTO program_tickers (stationId, revision, settings, bitmap) VALUES (?, ?, ?, ?)')
        .run(id, revision + 1, JSON.stringify(settings), bitmap);
      insertAuditEvent(db, { organizationId: req.user.organizationId, userId: req.user.id,
        action: 'PROGRAM_TICKER_APPLY', resourceType: 'Station', resourceId: id,
        details: { revision: revision + 1, enabled: settings.enabled } });
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    updateTicker({ revision: revision + 1, settings, bitmap });
    res.json({ success: true, data: { revision: revision + 1, settings } });
  } catch (error) { next(error); }
});
