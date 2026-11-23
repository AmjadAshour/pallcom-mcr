import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyPlayoutPlan, emptyPlayoutState, projectTimeline } from '@mcr/shared';
import { PlayoutEngine } from '../src/infrastructure/playout/engine.js';

function live(id, durationMs, hardStartAt = null) {
  return { id, title: id, kind: 'live', category: 'live', sceneName: id, durationMs, hardStartAt };
}

function fixture(context, plan) {
  let time = 100000;
  let current = 'Operator scene';
  let state = emptyPlayoutState();
  const logs = new Map();
  const commands = [];
  const repository = {
    load: () => ({ plan, state }),
    persist(_stationId, newPlan, newState, records) {
      plan = structuredClone(newPlan);
      state = structuredClone(newState);
      for (const record of records) {
        if (record.end) logs.set(record.id, { ...logs.get(record.id), endedAt: record.endedAt, outcome: record.outcome });
        else logs.set(record.id, record);
      }
    }
  };
  const transport = async (_stationId, command, params) => {
    commands.push({ command, params });
    if (command === 'TakePlayoutScene') {
      current = params.sceneName;
      return { sceneName: current };
    }
    if (command === 'CuePlayoutMedia') {
      if (params.assetId === 'missing') throw new Error('Media file is missing');
      return { id: params.assetId };
    }
    if (command === 'TakePlayoutMedia') {
      current = 'Deck A';
      return { sceneName: current, inputName: 'A media', cursorMs: 0 };
    }
    if (command === 'GetPlayoutStatus') return { sceneName: current, mediaState: 'OBS_MEDIA_STATE_PLAYING', cursorMs: 0 };
    return {};
  };
  const engine = new PlayoutEngine('station', repository, transport, { now: () => time });
  context.after(() => engine.dispose());
  return { engine, logs, commands, at(ms) { time = ms; }, setProgram(scene) { current = scene; },
    async step() { clearTimeout(engine.timer); await engine.serialize(() => engine.drive()); clearTimeout(engine.timer); } };
}

test('timeline projects an exact hard start and marks trimmed and bypassed rows', () => {
  const rows = projectTimeline([live('first', 15000), live('bypassed', 3000), live('news', 6000, 110005), live('next', 5000)], 100000);
  assert.deepEqual(rows.map(({ startAt, endAt, trimmed, skipped }) => [startAt, endAt, trimmed, skipped]), [
    [100000, 110005, true, false], [null, null, false, true],
    [110005, 116005, false, false], [116005, 121005, false, false]
  ]);
});

test('hot edits leave Program alone and a fixed event preempts it and is logged', async (context) => {
  const plan = { ...emptyPlayoutPlan(), backupScene: 'Backup',
    items: [live('first', 30000), live('news', 7000, 110005), live('A', 5000), live('B', 5000)] };
  const { engine, commands, logs, at, step } = fixture(context, plan);
  await engine.setReady(true);
  await engine.control('start');
  await step();
  assert.equal(engine.snapshot().state.active.item.id, 'first');
  const started = engine.snapshot().state.active.startedAt;
  const commandCount = commands.length;
  await engine.savePlan({ ...plan, items: [plan.items[0], plan.items[1], plan.items[3], plan.items[2]] });
  clearTimeout(engine.timer);
  assert.equal(commands.length, commandCount);
  assert.equal(engine.snapshot().state.active.startedAt, started);
  await assert.rejects(engine.savePlan(plan), /another session/);

  at(110004); await step();
  assert.equal(engine.snapshot().state.active.item.id, 'first');
  at(110005); await step();
  assert.equal(engine.snapshot().state.active.item.id, 'news');
  assert.equal(engine.snapshot().next.id, 'B');
  const first = [...logs.values()].find((entry) => entry.itemId === 'first');
  const news = [...logs.values()].find((entry) => entry.itemId === 'news');
  assert.equal(first.endedAt, 110005);
  assert.equal(first.outcome, 'hard-start');
  assert.equal(news.plannedAt, news.startedAt);
});

test('damaged media falls through to filler, and manual Program changes release the engine', async (context) => {
  const media = (id) => ({ id, title: id, kind: 'media', category: 'filler', durationMs: 5000, assetId: id, hardStartAt: null });
  const plan = { ...emptyPlayoutPlan(), backupScene: 'Backup', loop: true,
    decks: [{ sceneName: 'Deck A', inputName: 'A media' }, { sceneName: 'Deck B', inputName: 'B media' }],
    items: [media('missing')], filler: [media('available')] };
  const { engine, logs, setProgram, step } = fixture(context, plan);
  await engine.setReady(true);
  await engine.control('start');
  await step();
  await step();
  assert.equal(engine.snapshot().state.active.item.id, 'available');
  assert.ok([...logs.values()].some((entry) => entry.itemId === 'missing' && entry.outcome === 'failed'));
  setProgram('Live Studio');
  await engine.programChanged('Live Studio');
  assert.equal(engine.snapshot().state.running, false);
  assert.equal(engine.snapshot().state.mode, 'manual');
});
