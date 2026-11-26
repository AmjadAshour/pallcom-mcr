import { ROLE_PERMISSIONS } from '@mcr/shared';
import { randomUUID } from 'node:crypto';
import { getSqliteDatabase } from '../database/sqlite.js';
import { programStatus } from './supervisor.js';
import { takeSavedScene } from './resume-source.js';

const day = 24 * 60 * 60 * 1000;

export function createProgramSchedule(db, { stationId, userId, sceneId, scene, dueAt, repeatDaily }) {
  const id = randomUUID();
  db.exec('SAVEPOINT add_program_schedule');
  try {
    const inserted = db.prepare("INSERT INTO program_schedule (id,stationId,userId,sceneId,scene,dueAt,state) VALUES (?,?,?,?,?,?,'pending') ON CONFLICT(stationId,dueAt) DO NOTHING")
      .run(id,stationId,userId,sceneId,scene,dueAt);
    if (inserted.changes && repeatDaily) db.prepare('INSERT INTO program_schedule_daily VALUES (?)').run(id);
    db.exec('RELEASE add_program_schedule');
    return inserted.changes ? id : null;
  } catch (error) {
    db.exec('ROLLBACK TO add_program_schedule; RELEASE add_program_schedule');
    throw error;
  }
}

export function startProgramSchedule(stationId, clock = Date.now) {
  if (!stationId) return;
  const db = getSqliteDatabase();
  const finish = db.prepare('UPDATE program_schedule SET state=?,executedAt=?,error=? WHERE id=?');
  db.prepare("UPDATE program_schedule SET state='failed',error='Runtime restarted during take' WHERE stationId=? AND state='running'").run(stationId);
  let executing = false;
  async function tick() {
    if (executing) return;
    const now = clock();
    const job = db.prepare("SELECT * FROM program_schedule WHERE stationId=? AND state='pending' AND dueAt<=? ORDER BY dueAt LIMIT 1")
      .get(stationId, now);
    if (!job) return;
    db.exec('BEGIN IMMEDIATE');
    let skipped = false;
    try {
      if (!db.prepare("UPDATE program_schedule SET state='running' WHERE id=? AND state='pending'").run(job.id).changes) {
        db.exec('ROLLBACK');
        return;
      }
      if (db.prepare('SELECT 1 FROM program_schedule_daily WHERE jobId=?').get(job.id)) {
        let dueAt = job.dueAt + day * (Math.floor((now - job.dueAt) / day) + 1);
        while (!createProgramSchedule(db, { ...job, dueAt, repeatDaily: true })) dueAt += day;
      }
      const hold = db.prepare('SELECT resumedAt FROM program_schedule_hold WHERE stationId=?').get(stationId);
      skipped = Boolean(hold && (hold.resumedAt === null || job.dueAt <= hold.resumedAt));
      if (skipped) finish.run('skipped',now,'Schedule was on hold',job.id);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    if (skipped) return;
    executing = true;
    try {
      if (now-job.dueAt > 30000) throw Error('Scheduled time missed');
      const user = db.prepare('SELECT u.role FROM users u JOIN stations s ON s.organizationId=u.organizationId WHERE s.id=? AND u.id=? AND u.isActive=1')
        .get(stationId, job.userId);
      const permissions = ROLE_PERMISSIONS[user?.role] ?? [];
      if (!permissions.includes('*') && !['station:control','schedule:manage'].every(p=>permissions.includes(p))) {
        throw Error('Scheduling permission revoked');
      }
      const saved = db.prepare('SELECT scene FROM program_named_scenes WHERE stationId=? AND id=?').get(stationId,job.sceneId);
      if (saved?.scene !== job.scene) throw Error('Saved scene changed after scheduling');
      if (programStatus(stationId).state !== 'running') throw Error('Program is stopped');
      await takeSavedScene(stationId, JSON.parse(job.scene));
      finish.run('aired',clock(),null,job.id);
    } catch (error) {
      finish.run('failed',clock(),error.statusCode || !error.code ? error.message : 'Schedule execution failed',job.id);
    } finally {
      executing = false;
    }
  }
  const timer = setInterval(() => {
    void tick().catch(error => console.error('Program scheduling tick failed', error.code ?? 'unknown'));
  }, 500);
  timer.unref();
  return timer;
}
