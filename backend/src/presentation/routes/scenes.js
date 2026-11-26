import { Router } from 'express';
import { z } from 'zod';
import { PROGRAM_SCENE_UPLOAD } from '@mcr/shared';
import { authenticate } from '../middlewares/auth.middleware.js';
import { authorize } from '../middlewares/rbac.middleware.js';
import { validateBody } from '../middlewares/validate.middleware.js';
import { getSqliteDatabase } from '../../infrastructure/database/sqlite.js';
import { insertAuditEvent } from '../../infrastructure/repositories/sqlite-audit-repository.js';
import { configured, renderLocalScenePreview, setSourceRecovery } from '../../infrastructure/program/supervisor.js';
import { rememberProgramSource, takeSavedScene } from '../../infrastructure/program/resume-source.js';
import { prepareSceneVideo } from '../../infrastructure/program/ad-creatives.js';
import { storeCreative } from '../../infrastructure/program/creative-library.js';

export const scenesRouter = Router();
const root = '/stations/:id/program/local-scene';
const uploadName = z.string().trim().min(1).max(100);
let uploading = false;
const localSchema = z.object({
  id: z.string().uuid().optional(), name: z.string().trim().min(1).max(80).optional(),
  video: z.string().uuid(), image: z.string().uuid().or(z.literal('')).optional(),
  x: z.number().min(0).max(95), y: z.number().min(0).max(95),
  w: z.number().min(5).max(100), h: z.number().min(5).max(100)
}).strict()
  .refine(s => !s.id || s.name, 'A named scene requires a name')
  .refine(s => !s.image || (s.x + s.w <= 100 && s.y + s.h <= 100), 'Image extends outside the canvas');
const schema = z.union([localSchema, z.object({
  id: z.string().uuid(), name: z.string().trim().min(1).max(80), type: z.literal('network'),
  input: z.enum(['primary','secondary']).optional()
}).strict()]);

function readScene(db, stationId, sceneId) {
  return sceneId
    ? db.prepare('SELECT scene FROM program_named_scenes WHERE stationId=? AND id=?').get(stationId, sceneId)
    : db.prepare('SELECT scene FROM program_local_scenes WHERE stationId=?').get(stationId);
}

function ownsStation(req) {
  return configured(req.params.id) && getSqliteDatabase().prepare('SELECT 1 FROM stations WHERE id=? AND organizationId=?')
    .get(req.params.id, req.user.organizationId);
}

scenesRouter.use(root, authenticate, authorize('station:control'), (req, res, next) => {
  if (!ownsStation(req)) return res.sendStatus(404);
  res.set('Cache-Control', 'no-store');
  next();
});

scenesRouter.get(root, (req, res) => {
  const row = getSqliteDatabase().prepare('SELECT scene FROM program_local_scenes WHERE stationId=?').get(req.params.id);
  res.json({ success: true, data: row ? JSON.parse(row.scene) : null });
});

scenesRouter.get(root + '/library', (req, res) => {
  const db = getSqliteDatabase();
  const legacy = readScene(db, req.params.id);
  const scenes = db.prepare('SELECT scene FROM program_named_scenes WHERE stationId=? ORDER BY rowid')
    .all(req.params.id).map(row => JSON.parse(row.scene));
  if (legacy) scenes.unshift(JSON.parse(legacy.scene));
  res.json({ success: true, data: scenes });
});

scenesRouter.post(root + '/video', async (req, res, next) => {
  const name = uploadName.safeParse(req.query.name);
  if (!name.success || !req.is('video/mp4')) {
    return res.status(400).json({ success: false, error: 'Choose a named MP4 video' });
  }
  if (Number(req.get('Content-Length')) > PROGRAM_SCENE_UPLOAD.maxMib * 1024 ** 2) {
    return res.status(413).json({ success: false, error: 'Video exceeds the upload limit' });
  }
  if (uploading) return res.status(409).json({ success: false, error: 'Another video is being prepared' });
  const db = getSqliteDatabase();
  const id = req.params.id;
  if (db.prepare('SELECT count(*) AS total FROM ad_assets WHERE stationId=?').get(id).total >= 32) {
    return res.status(409).json({ success: false, error: 'Media library is full (32 files)' });
  }
  uploading = true;
  try {
    let prepared;
    try { prepared = await prepareSceneVideo(req); }
    catch (error) {
      if (req.aborted) return;
      if (error.statusCode === 413) return res.status(413).json({ success: false, error: error.message });
      if (error.code === 'ENOENT') return res.status(503).json({ success: false, error: 'FFmpeg is unavailable on the media host' });
      return res.status(400).json({ success: false,
        error: 'Unreadable MP4 or video exceeds the ' + PROGRAM_SCENE_UPLOAD.maxSeconds + '-second limit' });
    }
    if (res.destroyed) return;
    if (!ownsStation(req)) return res.sendStatus(404);
    db.exec('BEGIN IMMEDIATE');
    let asset;
    try {
      asset = storeCreative(db, id, name.data, prepared);
      insertAuditEvent(db, { organizationId: req.user.organizationId, userId: req.user.id,
        action: 'PROGRAM_SCENE_VIDEO_UPLOAD', resourceType: 'Station', resourceId: id, details: { asset: asset.id } });
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    res.status(201).json({ success: true, data: asset });
  } catch (error) { next(error); }
  finally { uploading = false; }
});

scenesRouter.post(root + '/video/take', validateBody(z.object({ video: z.string().uuid() }).strict()), async (req, res, next) => {
  try {
    const id = req.params.id;
    const { video } = req.body;
    const settings = { video, x: 0, y: 0, w: 100, h: 100 };
    insertAuditEvent(getSqliteDatabase(), { organizationId: req.user.organizationId, userId: req.user.id,
      action: 'PROGRAM_VIDEO_TAKE_REQUEST', resourceType: 'Station', resourceId: id, details: { asset: video } });
    const data = await takeSavedScene(id, settings);
    rememberProgramSource(id, { source: 'scene', scene: settings });
    setSourceRecovery(data.session, 'cancelled');
    res.json({ success: true, data });
  } catch (error) { next(error); }
});

scenesRouter.put(root, validateBody(schema), (req, res) => {
  const db = getSqliteDatabase();
  const id = req.params.id;
  if (req.body.type !== 'network') {
    const asset = db.prepare('SELECT frames FROM ad_assets WHERE stationId=? AND id=? AND kind=?');
    if (!asset.get(id, req.body.video, 'video')?.frames || (req.body.image && !asset.get(id, req.body.image, 'image')?.frames)) {
      return res.status(400).json({ success:false, error:'Select an available video and optional overlay image' });
    }
  }
  if (req.body.id) {
    const count = db.prepare('SELECT count(*) AS total FROM program_named_scenes WHERE stationId=?').get(id).total;
    if (count >= 32 && !readScene(db, id, req.body.id)) {
      return res.status(409).json({ success: false, error: 'The station has reached its 32 named scene limit' });
    }
    db.prepare('INSERT INTO program_named_scenes VALUES (?,?,?) ON CONFLICT(stationId,id) DO UPDATE SET scene=excluded.scene')
      .run(id, req.body.id, JSON.stringify(req.body));
  } else {
    db.prepare('INSERT OR REPLACE INTO program_local_scenes VALUES (?,?)').run(id, JSON.stringify(req.body));
  }
  res.json({ success:true });
});

scenesRouter.post(root + '/preview', validateBody(localSchema), async (req, res, next) => {
  try {
    const db = getSqliteDatabase();
    const asset = db.prepare('SELECT id FROM ad_assets WHERE stationId=? AND id=? AND kind=?');
    const frame = db.prepare('SELECT data FROM ad_frames WHERE stationId=? AND asset=? AND frame=0');
    const id = req.params.id;
    const video = asset.get(id, req.body.video, 'video') && frame.get(id, req.body.video);
    const image = req.body.image && asset.get(id, req.body.image, 'image') && frame.get(id, req.body.image);
    if (!video || (req.body.image && !image)) return res.status(409).json({success:false,error:'A scene asset is unavailable'});
    const data = await renderLocalScenePreview(req.body, video.data, image?.data);
    res.json({success:true,data});
  } catch (error) { next(error); }
});

scenesRouter.post(root + '/take', validateBody(schema), async (req, res, next) => {
  try {
    const transition = req.query.transition ?? 'cut';
    if (transition !== 'cut' && transition !== 'fade') {
      return res.status(400).json({success:false,error:'Choose cut or fade'});
    }
    const fade = transition === 'fade';
    const db = getSqliteDatabase();
    const id = req.params.id;
    const row = readScene(db, id, req.body.id);
    if (!row) return res.status(409).json({success:false,error:'Save the local scene before taking it'});
    const settings = JSON.parse(row.scene);
    if (Object.keys({ ...settings, ...req.body }).some(key => settings[key] !== req.body[key])) {
      return res.status(409).json({success:false,error:'Saved scene changed. Save or reload before taking it'});
    }
    insertAuditEvent(db, { organizationId:req.user.organizationId, userId:req.user.id,
      action:settings.type === 'network' ? 'PROGRAM_NETWORK_SCENE_TAKE_REQUEST' : 'PROGRAM_LOCAL_SCENE_TAKE_REQUEST',
      resourceType:'Station', resourceId:id, details:{sceneId:settings.id ?? null, transition} });
    const data = await takeSavedScene(id, settings, fade);
    rememberProgramSource(id, {source:'scene', scene:settings});
    res.json({success:true,data});
  } catch (error) { next(error); }
});
