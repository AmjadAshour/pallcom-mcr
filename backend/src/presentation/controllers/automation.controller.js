import { randomUUID } from 'node:crypto';
import { getSqliteDatabase } from '../../infrastructure/database/sqlite.js';
import { RepositoryFactory } from '../../infrastructure/repositories/repository-factory.js';
import { insertAuditEvent } from '../../infrastructure/repositories/sqlite-audit-repository.js';
import { agentGateway } from '../../infrastructure/agent/agent-gateway.js';
import { hasPermission } from '../middlewares/rbac.middleware.js';

const actionCommands = Object.freeze({
  scene: 'SetCurrentProgramScene',
  recordingStart: 'StartRecord',
  recordingStop: 'StopRecord'
});

function database() {
  return getSqliteDatabase();
}

function transaction(db, write) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = write();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

async function execute(db, job, actorId = job.userId) {
  let error = null;
  try {
    if (job.runAt) {
      const user = await RepositoryFactory.getUserRepository().findById(job.userId);
      if (!user?.isActive || (user.organizationId || 'default-org') !== job.organizationId ||
          !hasPermission(user.role, 'schedule:manage')) {
        throw new Error('The creator is no longer authorized to schedule commands');
      }
    }
    const station = await RepositoryFactory.getStationRepository().findById(job.stationId, job.organizationId);
    if (!station || !agentGateway.isAgentOnline(station.id)) throw new Error('Station is unavailable');
    await agentGateway.sendCommand(station.id, actionCommands[job.action], { sceneName: job.sceneName });
  } catch (failure) {
    error = failure.message;
  }
  db.prepare('UPDATE station_automations SET status = ?, error = ? WHERE id = ?').run(error ? 'FAILED' : 'SUCCEEDED', error, job.id);
  await RepositoryFactory.getAuditRepository().create({
    organizationId: job.organizationId, userId: actorId,
    action: error ? 'AUTOMATION_FAILED' : 'AUTOMATION_EXECUTED', resourceType: 'Station',
    resourceId: job.stationId, details: { automationId: job.id, name: job.name, error }
  });
  return { ...job, status: error ? 'FAILED' : 'SUCCEEDED', error };
}

function claim(db, job) {
  return db.prepare("UPDATE station_automations SET status = 'RUNNING', error = NULL WHERE id = ? AND status = ?")
    .run(job.id, job.status).changes === 1;
}

export function startAutomationWorker() {
  const db = database();
  db.prepare("UPDATE station_automations SET status = 'FAILED', error = 'Server restarted during execution' WHERE status = 'RUNNING'").run();
  const timer = setInterval(() => {
    const jobs = db.prepare("SELECT * FROM station_automations WHERE status = 'SCHEDULED' AND runAt <= ? ORDER BY runAt LIMIT 20")
      .all(new Date().toISOString());
    for (const job of jobs) {
      if (claim(db, job)) void execute(db, job).catch(console.error);
    }
  }, 1000);
  timer.unref();
  return () => clearInterval(timer);
}

export const AutomationController = {
  async list(req, res) {
    const data = database().prepare('SELECT * FROM station_automations WHERE organizationId = ? ORDER BY rowid DESC')
      .all(req.user.organizationId);
    res.json({ success: true, data });
  },

  async create(req, res, next) {
    try {
      const { name, stationId, action, sceneName, runAt } = req.body;
      if (!hasPermission(req.user.role, runAt ? 'schedule:manage' : 'macro:manage')) {
        return res.status(403).json({ success: false, error: 'Permission required to create this automation' });
      }
      const station = await RepositoryFactory.getStationRepository().findById(stationId, req.user.organizationId);
      if (!station) return res.status(404).json({ success: false, error: 'Station not found' });
      if (runAt && Date.parse(runAt) <= Date.now()) return res.status(400).json({ success: false, error: 'Schedule must be in the future' });
      const db = database();
      const id = randomUUID();
      const { organizationId, id: userId } = req.user;
      transaction(db, () => {
        db.prepare(`INSERT INTO station_automations (id, organizationId, userId, stationId, name, action, sceneName, runAt, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, organizationId, userId, stationId, name, action, sceneName ?? null,
          runAt ?? null, runAt ? 'SCHEDULED' : 'READY');
        insertAuditEvent(db, {
          organizationId, userId, action: 'AUTOMATION_CREATED', resourceType: 'Station', resourceId: stationId,
          details: { automationId: id, mode: runAt ? 'scheduled' : 'manual' }, ipAddress: req.ip
        });
      });
      res.status(201).json({ success: true, id });
    } catch (error) {
      next(error);
    }
  },

  async run(req, res, next) {
    try {
      if (!hasPermission(req.user.role, 'macro:execute') && !hasPermission(req.user.role, 'macro:manage')) {
        return res.status(403).json({ success: false, error: 'Permission required to execute macros' });
      }
      const db = database();
      const job = db.prepare('SELECT * FROM station_automations WHERE id = ? AND organizationId = ?')
        .get(req.params.id, req.user.organizationId);
      if (!job) return res.status(404).json({ success: false, error: 'Automation not found' });
      if (job.runAt || !['READY', 'SUCCEEDED', 'FAILED'].includes(job.status) || !claim(db, job)) {
        return res.status(409).json({ success: false, error: 'Automation cannot run right now' });
      }
      const data = await execute(db, job, req.user.id);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async cancel(req, res, next) {
    try {
      if (!hasPermission(req.user.role, 'schedule:manage')) {
        return res.status(403).json({ success: false, error: 'Permission required to cancel schedules' });
      }
      const db = database();
      const { organizationId, id: userId } = req.user;
      const job = transaction(db, () => {
        const cancelled = db.prepare(`UPDATE station_automations SET status = 'CANCELLED'
          WHERE id = ? AND organizationId = ? AND status = 'SCHEDULED'
          RETURNING id, stationId`).get(req.params.id, organizationId);
        if (cancelled) {
          insertAuditEvent(db, {
            organizationId, userId, action: 'AUTOMATION_CANCELLED', resourceType: 'Station',
            resourceId: cancelled.stationId, details: { automationId: cancelled.id }, ipAddress: req.ip
          });
        }
        return cancelled;
      });
      if (!job) return res.status(409).json({ success: false, error: 'Schedule is no longer pending' });
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  }
};
