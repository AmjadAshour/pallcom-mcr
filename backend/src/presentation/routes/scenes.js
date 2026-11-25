import { Router } from 'express';
import { createProgramSchedule } from '../../infrastructure/program/schedule.js';
import { z } from 'zod';
import { authenticate } from '../middlewares/auth.middleware.js';
import { authorize } from '../middlewares/rbac.middleware.js';
import { validateBody } from '../middlewares/validate.middleware.js';
import { getSqliteDatabase } from '../../infrastructure/database/sqlite.js';
import { insertAuditEvent } from '../../infrastructure/repositories/sqlite-audit-repository.js';
import { configured, renderLocalScenePreview } from '../../infrastructure/program/supervisor.js';
import { rememberProgramSource, takeSavedScene } from '../../infrastructure/program/resume-source.js';

export const scenesRouter = Router();
const root = '/stations/:id/program/local-scene';
const localSchema = z.object({
  id: z.string().uuid().optional(), name: z.string().trim().min(1).max(80).optional(),
  video: z.string().uuid(), image: z.string().uuid(),
  x: z.number().min(0).max(95), y: z.number().min(0).max(95),
  w: z.number().min(5).max(100), h: z.number().min(5).max(100)
}).strict()
  .refine(s => !s.id || s.name, 'A named scene requires a name')
  .refine(s => s.x + s.w <= 100 && s.y + s.h <= 100, 'Image extends outside the canvas');
const schema = z.union([localSchema, z.object({
  id: z.string().uuid(), name: z.string().trim().min(1).max(80), type: z.literal('network'),
  input: z.enum(['primary','secondary']).optional()
}).strict()]);

function readScene(db, stationId, sceneId) {
  return sceneId
    ? db.prepare('SELECT scene FROM program_named_scenes WHERE stationId=? AND id=?').get(stationId, sceneId)
    : db.prepare('SELECT scene FROM program_local_scenes WHERE stationId=?').get(stationId);
}

scenesRouter.use(root, authenticate, authorize('station:control'), (req, res, next) => {
  const db = getSqliteDatabase();
  if (!configured(req.params.id) || !db.prepare('SELECT 1 FROM stations WHERE id=? AND organizationId=?')
    .get(req.params.id, req.user.organizationId)) return res.sendStatus(404);
  res.set('Cache-Control', 'no-store');
  next();
});

scenesRouter.get(root + '/schedule', (req,res) => {
  const data = getSqliteDatabase().prepare(`SELECT id,sceneId,dueAt,state,executedAt,error,
    EXISTS(SELECT 1 FROM program_schedule_daily WHERE jobId=id) AS repeatDaily
    FROM program_schedule WHERE stationId=? ORDER BY state='pending' DESC,dueAt DESC LIMIT 100`)
    .all(req.params.id);
  res.json({success:true,data});
});

function csvCell(value) {
  const text = String(value ?? '');
  const safe = /^\s*[=+@-]|^[\t\r\n]/.test(text) ? "'" + text : text;
  return '"' + safe.replaceAll('"', '""') + '"';
}

scenesRouter.get(root + '/schedule.csv', (req,res) => {
  const rows = getSqliteDatabase().prepare(`SELECT id,sceneId,scene,dueAt,state,executedAt,error,
    EXISTS(SELECT 1 FROM program_schedule_daily WHERE jobId=id) AS repeatDaily
    FROM program_schedule WHERE stationId=? ORDER BY dueAt DESC LIMIT 10000`).all(req.params.id);
  const timestamp = value => value === null ? '' : new Date(value).toISOString();
  const lines = ['event_id,scene_id,scene_name,scheduled_at_utc,result,processed_at_utc,repeat_daily,detail'];
  for (const row of rows) {
    lines.push([row.id,row.sceneId,JSON.parse(row.scene).name,row.dueAt === null ? '' : timestamp(row.dueAt),
      row.state === 'aired' ? 'take_accepted' : row.state,timestamp(row.executedAt),
      row.repeatDaily ? 'yes' : 'no',row.error].map(csvCell).join(','));
  }
  res.attachment('program-schedule.csv').type('text/csv').send('\uFEFF' + lines.join('\r\n') + '\r\n');
});

scenesRouter.get(root + '/schedule-hold', (req,res) => {
  const hold = getSqliteDatabase().prepare('SELECT resumedAt FROM program_schedule_hold WHERE stationId=?').get(req.params.id);
  res.json({success:true,data:{held:hold?.resumedAt === null}});
});

scenesRouter.put(root + '/schedule-hold', authorize('schedule:manage'),
  validateBody(z.object({held:z.boolean()}).strict()), (req,res) => {
    const db = getSqliteDatabase();
    const stationId = req.params.id;
    const { held } = req.body;
    if (held) {
      db.prepare('INSERT INTO program_schedule_hold VALUES (?,NULL) ON CONFLICT(stationId) DO UPDATE SET resumedAt=NULL')
        .run(stationId);
    } else {
      db.prepare('UPDATE program_schedule_hold SET resumedAt=? WHERE stationId=? AND resumedAt IS NULL')
        .run(Date.now(),stationId);
    }
    res.json({success:true,data:{held}});
  });

scenesRouter.post(root + '/schedule', authorize('schedule:manage'), validateBody(z.object({
  sceneId:z.string().uuid(), dueAt:z.number().int().max(253402214400000), repeatDaily:z.boolean().optional()
}).strict()), (req,res) => {
  const db = getSqliteDatabase();
  const {sceneId,dueAt} = req.body;
  const stationId = req.params.id;
  if (dueAt <= Date.now()) return res.status(400).json({success:false,error:'Choose a future time'});
  const saved = readScene(db,stationId,sceneId);
  if (!saved) return res.sendStatus(404);
  const id = createProgramSchedule(db, {stationId,userId:req.user.id,sceneId,scene:saved.scene,dueAt,
    repeatDaily:req.body.repeatDaily});
  if (!id) return res.status(409).json({success:false,error:'Another event is scheduled at that time'});
  res.status(201).json({success:true,data:{id}});
});

scenesRouter.patch(root + '/schedule/:jobId', authorize('schedule:manage'), validateBody(z.object({
  dueAt:z.number().int().max(253402214400000), previousDueAt:z.number().int()
}).strict()), (req,res) => {
  const {dueAt,previousDueAt} = req.body;
  const now = Date.now();
  if (dueAt <= now) return res.status(400).json({success:false,error:'Choose a future time'});
  const result = getSqliteDatabase().prepare(`UPDATE OR IGNORE program_schedule SET dueAt=?
    WHERE stationId=? AND id=? AND state='pending' AND dueAt=? AND dueAt>?`)
    .run(dueAt,req.params.id,req.params.jobId,previousDueAt,now);
  if (!result.changes) return res.status(409).json({success:false,error:'The event changed, is already due, or the new time is occupied'});
  res.json({success:true});
});

scenesRouter.delete(root + '/schedule/:jobId', authorize('schedule:manage'), (req,res) => {
  const removed = getSqliteDatabase().prepare("DELETE FROM program_schedule WHERE stationId=? AND id=? AND state='pending'")
    .run(req.params.id,req.params.jobId);
  if (!removed.changes) return res.status(409).json({success:false,error:'The event is no longer pending'});
  res.json({success:true});
});

scenesRouter.post(root + '/schedule-list', authorize('schedule:manage'), validateBody(z.object({
  dueAt:z.number().int().max(253402214400000),
  fillerSceneId:z.string().uuid().optional(),
  items:z.array(z.object({ sceneId:z.string().uuid(), durationSeconds:z.number().int().min(1).max(86400) }).strict())
    .min(2).max(32)
}).strict()), (req,res) => {
  const db = getSqliteDatabase();
  const stationId = req.params.id;
  let dueAt = req.body.dueAt;
  if (dueAt <= Date.now()) return res.status(400).json({success:false,error:'Choose a future time'});
  const entries = req.body.items.map(({ sceneId, durationSeconds }) => {
    const entry = {stationId, userId:req.user.id, sceneId, scene:readScene(db,stationId,sceneId)?.scene, dueAt};
    dueAt += durationSeconds * 1000;
    return entry;
  });
  const fillerId = req.body.fillerSceneId;
  if (fillerId) {
    const saved = readScene(db,stationId,fillerId);
    if (!saved) return res.sendStatus(404);
    if (JSON.parse(saved.scene).type === 'network') {
      return res.status(400).json({success:false,error:'Choose a local scene for filler'});
    }
    entries.push({stationId,userId:req.user.id,sceneId:fillerId,scene:saved.scene,dueAt});
  }
  if (entries.some(entry => !entry.scene)) return res.sendStatus(404);
  db.exec('BEGIN IMMEDIATE');
  try {
    const ids = [];
    for (const entry of entries) {
      const id = createProgramSchedule(db, entry);
      if (!id) {
        db.exec('ROLLBACK');
        return res.status(409).json({success:false,error:'A list entry conflicts with an existing event'});
      }
      ids.push(id);
    }
    db.exec('COMMIT');
    res.status(201).json({success:true,data:{ids}});
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
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

scenesRouter.put(root, validateBody(schema), (req, res) => {
  const db = getSqliteDatabase();
  const id = req.params.id;
  if (req.body.type !== 'network') {
    const asset = db.prepare('SELECT frames FROM ad_assets WHERE stationId=? AND id=? AND kind=?');
    if (!asset.get(id, req.body.video, 'video')?.frames || !asset.get(id, req.body.image, 'image')?.frames) {
      return res.status(400).json({ success:false, error:'Select an available video and image' });
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
    const image = asset.get(id, req.body.image, 'image') && frame.get(id, req.body.image);
    if (!video || !image) return res.status(409).json({success:false,error:'A scene asset is unavailable'});
    const data = await renderLocalScenePreview(req.body, video.data, image.data);
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
