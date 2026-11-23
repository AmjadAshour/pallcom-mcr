import { createHash, randomBytes } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import sharp from 'sharp';
import { getSqliteDatabase } from '../../infrastructure/database/sqlite.js';
import { RepositoryFactory } from '../../infrastructure/repositories/repository-factory.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { authorize } from '../middlewares/rbac.middleware.js';
import { validateBody } from '../middlewares/validate.middleware.js';

export const graphicsRouter = Router();
const kinds = ['ad', 'logo', 'ticker'];
const root = '/stations/:id/graphics';

function decodeImage(image) {
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(image);
  if (!match) return null;
  const [, type, encoded] = match;
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length > 512 * 1024 || bytes.toString('base64') !== encoded) return null;
  const valid = {
    png: bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a',
    jpeg: bytes.subarray(0, 3).toString('hex') === 'ffd8ff',
    webp: bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
  };
  return valid[type] ? { bytes, type } : null;
}

const settingsSchema = z.object({
  content: z.string().trim().max(600),
  image: z.string().max(700000).refine((image) => !image || Boolean(decodeImage(image)), 'Use a PNG, JPEG, or WebP image up to 512 KB')
});
const timerSchema = z.object({ duration: z.number().int().min(0).max(86400) });

async function validateImage(req, res, next) {
  if (!req.body.image) return next();
  try {
    const { bytes, type } = decodeImage(req.body.image);
    const decoder = sharp(bytes, { failOn: 'warning', limitInputPixels: 4096 * 2160 });
    const metadata = await decoder.metadata();
    if (metadata.format !== type || !metadata.width || !metadata.height ||
      metadata.width > 4096 || metadata.height > 4096 || (metadata.pages ?? 1) !== 1) {
      throw new Error('Unsupported image');
    }
    await decoder.stats();
    return next();
  } catch {
    return res.status(400).json({ success: false, error: 'Use a valid single-frame image up to 4096 pixels per side and 8.8 megapixels' });
  }
}

function stationHandler(handler) {
  return async (req, res, next) => {
    try {
      const station = await RepositoryFactory.getStationRepository().findById(req.params.id, req.user.organizationId);
      if (!station || (req.params.kind && !kinds.includes(req.params.kind))) {
        return res.status(404).json({ success: false, error: 'Station or overlay not found' });
      }
      // Validate identity again at the synchronous SQL boundary so an async lookup
      // cannot recreate graphics after a concurrent station deletion.
      const db = getSqliteDatabase();
      if (!db.prepare('SELECT 1 FROM stations WHERE id = ? AND organizationId = ?').get(station.id, req.user.organizationId)) {
        return res.status(404).json({ success: false, error: 'Station not found' });
      }
      handler(req, res, db);
    } catch (error) {
      next(error);
    }
  };
}

function active(row, now = Date.now()) {
  return Boolean(row.published) && (row.expiresAt === null || row.expiresAt > now);
}

function readItems(db, stationId) {
  return db.prepare('SELECT * FROM station_graphics WHERE stationId = ?').all(stationId);
}

graphicsRouter.get(root, authenticate, authorize('station:control'), stationHandler((req, res, db) => {
  const id = req.params.id;
  db.prepare('INSERT OR IGNORE INTO station_graphics_tokens (stationId, token) VALUES (?, ?)')
    .run(id, randomBytes(32).toString('hex'));
  const { token } = db.prepare('SELECT token FROM station_graphics_tokens WHERE stationId = ?').get(id);
  const items = readItems(db, id).map(({ kind, content, image, published, expiresAt }) => ({
    kind, content, image, expiresAt, active: active({ published, expiresAt })
  }));
  res.set('Cache-Control', 'no-store').json({ success: true, data: { token, items } });
}));

graphicsRouter.post(root + '/rotate-link', authenticate, authorize('station:control'), stationHandler((req, res, db) => {
  const token = randomBytes(32).toString('hex');
  db.prepare(`INSERT INTO station_graphics_tokens (stationId, token) VALUES (?, ?)
    ON CONFLICT(stationId) DO UPDATE SET token = excluded.token`).run(req.params.id, token);
  res.set('Cache-Control', 'no-store').json({ success: true, token });
}));

graphicsRouter.put(root + '/:kind', authenticate, authorize('station:control'), validateBody(settingsSchema), validateImage, stationHandler((req, res, db) => {
  const { id, kind } = req.params;
  const { content, image } = req.body;
  if ((kind === 'logo' && !image) || (kind === 'ticker' && (!content || image)) ||
    (kind === 'ad' && !content && !image)) {
    return res.status(400).json({ success: false, error: 'Provide the required overlay content' });
  }
  const revision = image ? createHash('sha256').update(image).digest('hex') : '';
  db.prepare(`INSERT INTO station_graphics (stationId, kind, content, image, imageRevision)
    VALUES (?, ?, ?, ?, ?) ON CONFLICT(stationId, kind)
    DO UPDATE SET content = excluded.content, image = excluded.image, imageRevision = excluded.imageRevision`)
    .run(id, kind, content, image, revision);
  res.json({ success: true });
}));

graphicsRouter.post(root + '/:kind/publish', authenticate, authorize('station:control'), validateBody(timerSchema), stationHandler((req, res, db) => {
  const { id, kind } = req.params;
  const expiresAt = req.body.duration ? Date.now() + req.body.duration * 1000 : null;
  const result = db.prepare('UPDATE station_graphics SET published = 1, expiresAt = ? WHERE stationId = ? AND kind = ?')
    .run(expiresAt, id, kind);
  if (!result.changes) return res.status(404).json({ success: false, error: 'Save the overlay before publishing' });
  res.json({ success: true, expiresAt });
}));

graphicsRouter.post(root + '/:kind/hide', authenticate, authorize('station:control'), stationHandler((req, res, db) => {
  db.prepare('UPDATE station_graphics SET published = 0, expiresAt = NULL WHERE stationId = ? AND kind = ?')
    .run(req.params.id, req.params.kind);
  res.json({ success: true });
}));

graphicsRouter.delete(root + '/:kind', authenticate, authorize('station:control'), stationHandler((req, res, db) => {
  db.prepare('DELETE FROM station_graphics WHERE stationId = ? AND kind = ?').run(req.params.id, req.params.kind);
  res.json({ success: true });
}));

function publicStation(req, res, next) {
  res.set('Cache-Control', 'no-store');
  if (!/^[a-f0-9]{64}$/.test(req.params.token)) return res.sendStatus(404);
  const db = getSqliteDatabase();
  const station = db.prepare(`SELECT s.id FROM station_graphics_tokens AS t
    JOIN stations AS s ON s.id = t.stationId WHERE t.token = ?`).get(req.params.token);
  if (!station) return res.sendStatus(404);
  res.locals.stationId = station.id;
  next();
}

graphicsRouter.get('/public/graphics/:token', publicStation, (req, res) => {
  const db = getSqliteDatabase();
  const now = Date.now();
  const data = readItems(db, res.locals.stationId).filter((item) => active(item, now)).map((item) => ({
    kind: item.kind, content: item.content,
    image: item.imageRevision ? '/api/v1/public/graphics/' + req.params.token + '/image/' + item.kind + '/' + item.imageRevision : '',
    remainingMs: item.expiresAt === null ? null : item.expiresAt - now
  }));
  res.json({ success: true, data });
});

graphicsRouter.get('/public/graphics/:token/image/:kind/:revision', publicStation, (req, res) => {
  const db = getSqliteDatabase();
  const row = db.prepare('SELECT * FROM station_graphics WHERE stationId = ? AND kind = ? AND imageRevision = ?')
    .get(res.locals.stationId, req.params.kind, req.params.revision);
  if (!row || !active(row)) return res.sendStatus(404);
  const image = decodeImage(row.image);
  if (!image) return res.sendStatus(404);
  res.type('image/' + image.type).send(image.bytes);
});
