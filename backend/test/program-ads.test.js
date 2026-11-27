import { reserveCreativeUpload } from '../src/infrastructure/program/creative-library.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { adLayer, transportAction, placementOrder, scheduledInstant } from '@mcr/shared';
import { applyPlacements } from '../src/infrastructure/program/ads.js';

const first = { asset: 'one', duration: 1000, gap: 500, enter: 200, exit: 200, dx: 10, dy: 0 };
const second = { asset: 'two', duration: 500, gap: 100, enter: 0, exit: 0, dx: 0, dy: 0 };
const p = {
  id: 'a',
  enabled: true,
  x: 4,
  y: 8,
  w: 20,
  h: 12,
  z: 2,
  start: 10000,
  end: 20000,
  items: [first, second]
};
const q = { ...p, id: 'b', items: [second] };
const initial = applyPlacements({ revision: 0, placements: [], transport: {} }, [p, q], 'UTC', 9000);
const sample = (placement, time, transport = initial.transport[placement.id], wall = time) =>
  adLayer(placement, transport, wall, time);

test('scheduled windows, per-ad gaps, fades, movement and simultaneous rotations', () => {
  assert.equal(sample(p, 9999), null);
  assert.equal(sample(p, 10100).alpha, 0.5);
  assert.equal(sample(p, 10100).x, 5);
  assert.equal(sample(q, 10100).asset, 'two');
  assert.equal(sample(p, 10900).alpha, 0.5);
  assert.equal(sample(p, 11000), null);
  assert.equal(sample(p, 11499), null);
  assert.equal(sample(p, 11500).asset, 'two');
  assert.equal(sample(p, 12050), null);
  assert.equal(sample(p, 12100).asset, 'one');
  assert.equal(sample(p, 20000), null);
  const limited = { ...p, items: [{ ...first, start: 10200, end: 10400 }, second] };
  assert.equal(sample(limited, 10199), null);
  assert.equal(sample(limited, 10200).asset, 'one');
  assert.equal(sample(limited, 10400), null);
  assert.deepEqual(
    [q, p].sort(placementOrder).map((e) => e.id),
    ['a', 'b']
  );
});
test('pause, skip a gap, resume, disable and restart preserve independent clocks', () => {
  let t = transportAction(p, initial.transport.a, 'pause', 11100);
  assert.equal(sample(p, 13000, t), null);
  t = transportAction(p, t, 'skip', 13000);
  assert.equal(sample(p, 14500, t).elapsed, 0);
  assert.equal(sample(p, 14500, t).asset, 'two');
  t = transportAction(p, t, 'resume', 14500);
  assert.equal(sample(p, 14600, JSON.parse(JSON.stringify(t))).elapsed, 100);
  assert.equal(sample(q, 14600).asset, 'two');
  assert.equal(sample(p, 14600, transportAction(p, t, 'disable', 14600)), null);
  assert.deepEqual(sample(p, 15000), sample(p, 15000, JSON.parse(JSON.stringify(initial)).transport.a));
  assert.equal(sample(p, 10100, initial.transport.a, 20001), null);
});
test('time zone conversion rejects DST gaps and folds and retains UTC instants', () => {
  assert.equal(scheduledInstant('2026-07-01T12:00', 'America/New_York'), Date.UTC(2026, 6, 1, 16));
  assert.throws(() => scheduledInstant('2026-03-08T02:30', 'America/New_York'));
  assert.throws(() => scheduledInstant('2026-11-01T01:30', 'America/New_York'));
});


test('creative upload reservation admits one preparation and releases capacity', () => {
  const release = reserveCreativeUpload();
  try {
    assert.throws(reserveCreativeUpload, { statusCode: 409 });
  } finally {
    release();
  }
  reserveCreativeUpload()();
});
