import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { agentGateway } from '../agent/agent-gateway.js';
import { getSqliteDatabase } from '../database/sqlite.js';
import { emptyPlayoutPlan as emptyPlan, emptyPlayoutState as emptyState, projectTimeline, estimateNext, fixedEvents, pendingMain } from '@mcr/shared';

const STANDBY = '__standby';
const CUE_LEAD_MS = 3000;
const WATCH_INTERVAL_MS = 1000;
const MAX_WAIT_MS = 30000;
const endingStates = new Set(['OBS_MEDIA_STATE_ENDED', 'OBS_MEDIA_STATE_STOPPED', 'OBS_MEDIA_STATE_ERROR']);

export class PlayoutEngine extends EventEmitter {
  constructor(stationId, repository, transport, clock = Date) {
    super();
    this.stationId = stationId;
    this.repository = repository;
    this.transport = transport;
    this.clock = clock;
    const record = repository.load(stationId);
    this.plan = record.plan;
    this.state = { ...record.state, stationReady: false };
    this.reconcile = Boolean(this.state.active);
    this.queue = Promise.resolve();
    this.timer = null;
    this.cue = null;
    this.generation = 0;
    this.failedMain = new Set();
    this.fillerFailures = 0;
    this.watchPending = false;
    this.lastWatchAt = 0;
    this.closed = false;
  }

  snapshot() {
    const now = this.clock.now();
    const active = this.state.active;
    const pending = pendingMain(this.plan, this.state.played);
    return {
      stationId: this.stationId, plan: this.plan, state: this.state, serverNow: now,
      next: estimateNext(this.plan, this.state, now),
      timeline: projectTimeline(pending, Math.max(now, active?.endsAt ?? now))
    };
  }

  serialize(operation) {
    const next = this.queue.then(() => {
      if (this.closed) return undefined;
      return operation();
    });
    this.queue = next.catch(() => {});
    return next;
  }

  publish(records = []) {
    if (this.closed) return;
    this.repository.persist(this.stationId, this.plan, this.state, records);
    this.emit('state', this.snapshot());
  }

  savePlan(plan) {
    return this.serialize(() => {
      if (plan.revision !== this.plan.revision) throw Object.assign(new Error('Playlist changed in another session'), { statusCode: 409 });
      if (this.state.running && JSON.stringify(plan.decks) !== JSON.stringify(this.plan.decks)) {
        throw Object.assign(new Error('Release automation before changing OBS decks'), { statusCode: 409 });
      }
      const last = this.plan;
      const state = this.state;
      const ids = new Set(plan.items.map((item) => item.id));
      this.plan = { ...plan, revision: plan.revision + 1 };
      this.state = {
        ...this.state,
        played: this.state.played.filter((id) => ids.has(id)),
        fillerIndex: JSON.stringify(last.filler) === JSON.stringify(plan.filler) ? state.fillerIndex : 0
      };
      try { this.publish(); }
      catch (error) { this.plan = last; this.state = state; throw error; }
      this.failedMain.clear();
      this.fillerFailures = 0;
      this.arm(0);
      if (this.state.active && this.state.stationReady) {
        void this.updateGraphics(this.state.active.sceneName).catch(() => {});
      }
      return this.snapshot();
    });
  }

  arm(delay, force = false, reason = 'completed') {
    clearTimeout(this.timer);
    if (this.closed || !this.state.running || !this.state.stationReady) return;
    this.timer = setTimeout(() => {
      this.serialize(() => this.drive(force, reason)).catch((error) => {
        console.error('[playout]', this.stationId, error);
        this.arm(1500);
      });
    }, Math.min(MAX_WAIT_MS, Math.max(0, delay)));
    this.timer.unref();
  }

  setReady(ready) {
    return this.serialize(async () => {
      if (this.state.stationReady === ready) return;
      this.state = { ...this.state, stationReady: ready };
      if (!ready) {
        clearTimeout(this.timer);
        this.generation++;
        this.cue = null;
        this.reconcile = Boolean(this.state.active);
        this.state = { ...this.state, alert: 'OBS disconnected' };
      } else {
        this.state = { ...this.state, alert: null };
      }
      this.publish();
      if (ready) this.arm(0);
    });
  }

  mediaEnded(inputName) {
    return this.serialize(async () => {
      const active = this.state.active;
      if (!this.state.running || !this.state.stationReady || !active?.inputName || active.inputName !== inputName) return;
      const status = await this.command('GetPlayoutStatus', { inputName }).catch(() => null);
      if (status?.sceneName === active.sceneName && endingStates.has(status.mediaState)) {
        await this.drive(true, status.mediaState === 'OBS_MEDIA_STATE_ERROR' ? 'media-error' : 'completed');
      }
    });
  }

  programChanged(sceneName) {
    return this.serialize(async () => {
      const active = this.state.active;
      if (!this.state.stationReady || !active || !this.state.running || sceneName === active.sceneName) return;
      const status = await this.command('GetPlayoutStatus').catch(() => null);
      if (status && status.sceneName !== active.sceneName) {
        clearTimeout(this.timer);
        const records = this.closeActive('manual-program-change');
        this.state = { ...this.state, running: false, mode: 'manual', alert: 'OBS Program was changed manually. Automation released control.' };
        this.publish(records);
      }
    });
  }

  command(name, params = {}, timeoutMs = 5000) {
    return this.transport(this.stationId, name, params, timeoutMs);
  }

  async control(action, value) {
    return this.serialize(async () => {
      if (action === 'release') {
        clearTimeout(this.timer);
        const records = this.closeActive('control-released');
        this.state = { ...this.state, running: false, mode: 'idle', alert: null };
        this.publish(records);
        return this.snapshot();
      }
      if (action === 'overlay') {
        const graphics = { ...this.plan.graphics, [value.overlay]: value.enabled };
        this.plan = { ...this.plan, graphics, revision: this.plan.revision + 1 };
        this.publish();
        if (this.state.stationReady) {
          const { sceneName } = await this.command('GetPlayoutStatus');
          await this.updateGraphics(sceneName);
        }
        return this.snapshot();
      }
      if (!this.state.stationReady) throw Object.assign(new Error('OBS is disconnected'), { statusCode: 503 });
      if (action === 'emergency') {
        const sceneName = value?.sceneName || this.plan.backupScene;
        if (!sceneName) throw Object.assign(new Error('Set an OBS backup scene first'), { statusCode: 400 });
        await this.take({ id: STANDBY, title: sceneName, kind: 'live', category: 'live', sceneName, durationMs: null }, 'emergency');
        this.state = { ...this.state, running: false, mode: 'emergency' };
        clearTimeout(this.timer);
        this.publish();
        return this.snapshot();
      }
      if (action === 'start') {
        if (!this.plan.backupScene) throw Object.assign(new Error('Configure an OBS backup scene before arming playout'), { statusCode: 400 });
        if (this.state.running) return this.snapshot();
        this.failedMain.clear();
        this.fillerFailures = 0;
        const fixedIds = new Set(fixedEvents(this.plan.items).map((item) => item.id));
        this.state = { ...this.state, running: true, mode: this.state.active ? this.state.mode : 'waiting', alert: null,
          played: this.state.mode === 'emergency' ? this.state.played : this.state.played.filter((id) => fixedIds.has(id)),
          fillerIndex: 0 };
        this.publish();
        this.arm(0);
        return this.snapshot();
      }
      if (!this.state.running) throw Object.assign(new Error('Start playout first'), { statusCode: 409 });
      if (action === 'restart') {
        const active = this.state.active;
        if (!active || active.item.id === STANDBY) throw Object.assign(new Error('No timed item to restart'), { statusCode: 409 });
        await this.take(active.item, 'restarted', null, active.lane);
        this.arm(0);
      }
      if (action === 'skip') await this.drive(true, 'skipped');
      return this.snapshot();
    });
  }

  closeActive(outcome, at = this.clock.now()) {
    const active = this.state.active;
    if (!active) return [];
    this.state = { ...this.state, active: null };
    return [{ id: active.logId, end: true, endedAt: at, outcome }];
  }

  record(item, outcome, detail, plannedAt = null) {
    return { id: randomUUID(), itemId: item.id, title: item.title, category: item.category,
      sceneName: item.sceneName ?? null, plannedAt, startedAt: null, endedAt: this.clock.now(), outcome, detail };
  }

  prepare(item) {
    if (!item || item.kind !== 'media') return null;
    const key = item.assetId + ':' + JSON.stringify(this.plan.decks);
    if (this.cue?.key === key) return this.cue;
    const preceding = this.cue?.promise;
    const generation = this.generation;
    const decks = this.plan.decks;
    const entry = { key, promise: null };
    entry.promise = Promise.resolve(preceding).then(() => {
      if (this.closed || generation !== this.generation) throw new Error('OBS disconnected before cue');
      if (!decks.length) throw new Error('Configure two OBS playout decks before taking media');
      return this.command('CuePlayoutMedia', { assetId: item.assetId, decks }, 10000);
    }).then((value) => ({ value }), (error) => ({ error }));
    this.cue = entry;
    return entry;
  }

  async take(item, reason, plannedAt = null, lane = 'main', consume = false) {
    if (this.closed) return;
    let outcome;
    if (item.kind === 'media') {
      const cue = this.prepare(item);
      const result = await cue.promise;
      if (this.cue === cue) this.cue = null;
      if (result.error) throw result.error;
      if (this.closed) return;
      outcome = await this.command('TakePlayoutMedia', { cue: result.value });
    } else {
      outcome = await this.command('TakePlayoutScene', { sceneName: item.sceneName });
    }
    if (this.closed) return;
    const airedAt = this.clock.now();
    const records = this.closeActive(reason, airedAt);
    const cursorMs = Math.max(0, Math.min(item.durationMs ?? 0, outcome.cursorMs || 0));
    const logId = randomUUID();
    const active = {
      item, lane, logId, sceneName: outcome.sceneName, inputName: outcome.inputName ?? null,
      startedAt: airedAt, clockStartAt: airedAt - cursorMs,
      endsAt: item.durationMs === null ? null : airedAt + item.durationMs - cursorMs
    };
    this.state = { ...this.state, active, mode: item.id === STANDBY ? 'standby' : 'playing', alert: null };
    if (consume && lane === 'main') this.state.played = [...this.state.played, item.id];
    if (consume && lane === 'filler') this.state.fillerIndex++;
    records.push({ id: logId, itemId: item.id, title: item.title, category: item.category, sceneName: active.sceneName,
      plannedAt, startedAt: airedAt, endedAt: null, outcome: 'on-air', detail: null });
    this.publish(records);
    // Graphics updates follow the confirmed picture cut and never delay scheduling the next deadline.
    void this.updateGraphics(active.sceneName, active).catch(() => {});
  }

  async updateGraphics(sceneName, active = this.state.active) {
    const { graphics } = this.plan;
    const overlays = [
      { source: graphics.logoSource, enabled: graphics.logo && !(graphics.hideLogoDuringAds && active?.item.category === 'ad') },
      { source: graphics.lowerThirdSource, enabled: graphics.lowerThird, text: graphics.lowerThird },
      { source: graphics.tickerSource, enabled: graphics.ticker }
    ].filter((item) => item.source);
    if (!overlays.length) return;
    const next = estimateNext(this.plan, this.state, this.clock.now());
    const nowNext = active ? `NOW: ${active.item.title}\nNEXT: ${next?.title ?? '—'}` : '';
    try {
      const result = await this.command('ApplyPlayoutGraphics', { sceneName, overlays, nowNext });
      if (result?.warnings?.length && !this.closed && this.state.active?.logId === active?.logId && !this.state.alert) {
        this.state = { ...this.state, alert: result.warnings.join(' · ') };
        this.publish();
      }
    } catch (error) {
      if (this.closed || (active && this.state.active?.logId !== active.logId)) return;
      this.state = { ...this.state, alert: 'Graphics: ' + error.message };
      this.publish();
    }
  }

  watchMedia(active, now) {
    if (!active.inputName || this.watchPending || now - this.lastWatchAt < WATCH_INTERVAL_MS) return;
    this.watchPending = true;
    this.lastWatchAt = now;
    void this.command('GetPlayoutStatus', { inputName: active.inputName }, 3000).then((status) => {
      if (status.sceneName !== active.sceneName || !endingStates.has(status.mediaState)) return;
      return this.serialize(async () => {
        if (this.state.active?.logId !== active.logId || !this.state.running || !this.state.stationReady) return;
        await this.drive(true, status.mediaState === 'OBS_MEDIA_STATE_ERROR' ? 'media-error' : 'completed');
      });
    }).catch(() => {}).finally(() => { this.watchPending = false; });
  }

  async reconcileActive() {
    this.reconcile = false;
    const active = this.state.active;
    if (!active) return true;
    let status;
    try { status = await this.command('GetPlayoutStatus', { inputName: active.inputName }); }
    catch {
      this.reconcile = true;
      this.arm(1000);
      return false;
    }
    if (status.sceneName !== active.sceneName) {
      const records = this.closeActive('program-changed-while-offline');
      this.state = { ...this.state, running: false, mode: 'manual', alert: 'Program changed while disconnected. Start playout to take control again.' };
      this.publish(records);
      return false;
    }
    if (active.inputName && endingStates.has(status.mediaState)) {
      this.state = { ...this.state, active: { ...active, endsAt: this.clock.now() } };
      this.publish();
      return true;
    }
    if (active.inputName && Number.isFinite(status.cursorMs)) {
      const now = this.clock.now();
      this.state = { ...this.state, active: {
        ...active, clockStartAt: now - status.cursorMs,
        endsAt: now + Math.max(1, active.item.durationMs - status.cursorMs)
      } };
      this.publish();
    }
    return true;
  }

  async drive(force = false, reason = 'completed') {
    if (this.closed || !this.state.running || !this.state.stationReady) return;
    if (this.reconcile && !await this.reconcileActive()) return;
    const now = this.clock.now();
    const records = [];
    const missed = new Set();
    for (const item of fixedEvents(pendingMain(this.plan, this.state.played))) {
      if (item.hardStartAt + item.durationMs > now) continue;
      missed.add(item.id);
      records.push(this.record(item, 'missed', 'Fixed event window elapsed while unavailable', item.hardStartAt));
    }
    if (missed.size) {
      this.state.played.push(...missed);
      this.publish(records.splice(0));
    }
    const pending = pendingMain(this.plan, this.state.played);
    const fixed = fixedEvents(pending);
    const due = fixed.filter((item) => item.hardStartAt <= now);
    const active = this.state.active;
    const expired = active?.endsAt !== null && active?.endsAt <= now;
    if (!due.length && !force && !expired && active && active.item.id !== STANDBY) {
      this.watchMedia(active, now);
      const deadline = Math.min(active.endsAt ?? Infinity, fixed[0]?.hardStartAt ?? Infinity);
      const next = estimateNext(this.plan, this.state, now);
      if (next?.kind === 'media' && deadline - now <= CUE_LEAD_MS) this.prepare(next);
      const cuePending = next?.kind === 'media' && deadline - now > CUE_LEAD_MS;
      const wait = deadline - now - (cuePending ? CUE_LEAD_MS : 0);
      this.arm(active.inputName ? Math.min(wait, WATCH_INTERVAL_MS) : wait);
      return;
    }

    let candidate = due.at(-1);
    let lane = 'main';
    if (candidate) {
      const index = this.plan.items.findIndex((item) => item.id === candidate.id);
      const bypassed = [...due.slice(0, -1), ...this.plan.items.slice(0, index)
        .filter((item) => item.hardStartAt === null && pending.some((entry) => entry.id === item.id))];
      for (const item of bypassed) {
        if (this.state.played.includes(item.id)) continue;
        this.state.played.push(item.id);
        records.push(this.record(item, 'superseded', 'Fixed start took priority', item.hardStartAt));
      }
      reason = 'hard-start';
    } else if (pending[0]?.hardStartAt === null) {
      candidate = pending[0];
    } else if (!pending.length && this.plan.loop) {
      candidate = this.plan.items.find((item) => item.hardStartAt === null && !this.failedMain.has(item.id));
      if (candidate) {
        const fixedIds = new Set(fixedEvents(this.plan.items).map((item) => item.id));
        this.state.played = this.state.played.filter((id) => fixedIds.has(id) || this.failedMain.has(id));
      }
    }
    if (!candidate && this.plan.filler.length) {
      lane = 'filler';
      candidate = this.plan.filler[this.state.fillerIndex % this.plan.filler.length];
    }
    if (records.length) this.publish(records);

    if (candidate) {
      const plannedAt = candidate.hardStartAt ?? active?.endsAt ?? now;
      try {
        await this.take(candidate, reason, plannedAt, lane, true);
        this.fillerFailures = 0;
        this.arm(0);
        return;
      } catch (error) {
        if (this.closed) return;
        if (lane === 'main') {
          this.state.played.push(candidate.id);
          this.failedMain.add(candidate.id);
        } else {
          this.state.fillerIndex++;
          this.fillerFailures++;
        }
        this.state = { ...this.state, alert: candidate.title + ': ' + error.message };
        this.publish([this.record(candidate, 'failed', error.message, plannedAt)]);
        if (lane === 'main' || this.fillerFailures < this.plan.filler.length) {
          this.arm(0, true, reason);
          return;
        }
      }
    }
    this.fillerFailures = 0;

    if (this.plan.backupScene && this.state.active?.item.id !== STANDBY) {
      try {
        const alert = this.state.alert;
        await this.take({ id: STANDBY, title: this.plan.backupScene, kind: 'live', category: 'filler',
          sceneName: this.plan.backupScene, durationMs: null }, reason, null, 'standby');
        if (alert) { this.state.alert = alert; this.publish(); }
      } catch (error) {
        this.state = { ...this.state, alert: 'Backup scene: ' + error.message };
        this.publish();
      }
    }
    const untilFixed = fixed[0] ? Math.max(0, fixed[0].hardStartAt - this.clock.now()) : Infinity;
    if (untilFixed <= CUE_LEAD_MS) this.prepare(fixed[0]);
    this.arm(Math.min(untilFixed, 1500));
  }

  dispose() {
    this.closed = true;
    this.generation++;
    clearTimeout(this.timer);
    this.removeAllListeners();
  }
}

function sqliteRepository() {
  const db = getSqliteDatabase();
  return {
    load(id) {
      const row = db.prepare('SELECT plan, state FROM station_playout WHERE stationId = ?').get(id);
      return row ? { plan: JSON.parse(row.plan), state: JSON.parse(row.state) } : { plan: emptyPlan(), state: emptyState() };
    },
    persist(id, plan, state, records) {
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare(`INSERT INTO station_playout (stationId, plan, state) VALUES (?, ?, ?)
          ON CONFLICT(stationId) DO UPDATE SET plan = excluded.plan, state = excluded.state`)
          .run(id, JSON.stringify(plan), JSON.stringify(state));
        for (const record of records) {
          if (record.end) {
            db.prepare('UPDATE playout_as_run SET endedAt=?, outcome=? WHERE id=? AND stationId=?')
              .run(record.endedAt, record.outcome, record.id, id);
          } else {
            db.prepare(`INSERT INTO playout_as_run
              (id, stationId, itemId, title, category, sceneName, plannedAt, startedAt, endedAt, outcome, detail)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(record.id, id, record.itemId, record.title,
              record.category, record.sceneName, record.plannedAt, record.startedAt, record.endedAt, record.outcome, record.detail);
          }
        }
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    }
  };
}

export const playoutEvents = new EventEmitter();
const engines = new Map();

function report(error) {
  console.error('[playout]', error);
}

export function stationPlayout(stationId) {
  if (engines.has(stationId)) return engines.get(stationId);
  const engine = new PlayoutEngine(stationId, sqliteRepository(), (...args) => agentGateway.sendCommand(...args));
  engines.set(stationId, engine);
  engine.on('state', (snapshot) => playoutEvents.emit('state', snapshot));
  const agent = agentGateway.connectedAgents.get(stationId);
  if (agent?.telemetry?.obsConnected === true) void engine.setReady(true).catch(report);
  return engine;
}

export function removeStationPlayout(stationId) {
  engines.get(stationId)?.dispose();
  engines.delete(stationId);
}

export function attachPlayout() {
  agentGateway.on('agentConnected', ({ stationId }) => {
    const engine = engines.get(stationId);
    if (engine) void engine.setReady(false).catch(report);
  });
  agentGateway.on('telemetry', ({ stationId, data }) => {
    const engine = engines.get(stationId);
    if (engine) void engine.setReady(data.obsConnected === true).catch(report);
  });
  agentGateway.on('agentDisconnected', ({ stationId }) => {
    const engine = engines.get(stationId);
    if (engine) void engine.setReady(false).catch(report);
  });
  agentGateway.on('obsEvent', ({ stationId, event, data }) => {
    const engine = engines.get(stationId);
    if (engine && event === 'mediaPlaybackEnded') void engine.mediaEnded(data.inputName).catch(report);
    if (engine && event === 'sceneChanged') void engine.programChanged(data.sceneName).catch(report);
  });
}

export function restorePlayout() {
  const db = getSqliteDatabase();
  for (const { stationId } of db.prepare(`SELECT p.stationId FROM station_playout p
    JOIN stations s ON p.stationId = s.id WHERE json_extract(p.state, '$.running') = 1`).all()) {
    stationPlayout(stationId);
  }
}

export function readPlayoutAssets(stationId) {
  const row = getSqliteDatabase().prepare('SELECT assets FROM station_playout WHERE stationId = ?').get(stationId);
  return row ? JSON.parse(row.assets) : [];
}

export function savePlayoutAssets(stationId, assets) {
  getSqliteDatabase().prepare(`INSERT INTO station_playout (stationId, plan, state, assets) VALUES (?, ?, ?, ?)
    ON CONFLICT(stationId) DO UPDATE SET assets = excluded.assets`)
    .run(stationId, JSON.stringify(emptyPlan()), JSON.stringify(emptyState()), JSON.stringify(assets));
}

export function readAsRun(stationId) {
  return getSqliteDatabase().prepare(`SELECT * FROM playout_as_run WHERE stationId = ?
    ORDER BY COALESCE(startedAt, endedAt) DESC, rowid DESC LIMIT 200`).all(stationId);
}
