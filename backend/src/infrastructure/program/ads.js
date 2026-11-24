import { getSqliteDatabase } from '../database/sqlite.js';
import { adLayer, placementOrder, PROGRAM_CANVAS } from '@mcr/shared';

export const runtimeNow = () => Math.round(performance.timeOrigin + performance.now());
const empty = () => ({ revision: 0, zone: 'UTC', placements: [], transport: {} });
export function adPlan(id) {
  const row = getSqliteDatabase().prepare('SELECT plan FROM program_ads WHERE stationId=?').get(id);
  return row ? JSON.parse(row.plan) : empty();
}

export function applyPlacements(previous, placements, zone, clock = runtimeNow()) {
  const transport = {};
  for (const p of placements) {
    const old = previous.placements.find((entry) => entry.id === p.id);
    const sameTimeline =
      old &&
      old.enabled === p.enabled &&
      old.start === p.start &&
      JSON.stringify(old.items) === JSON.stringify(p.items);
    transport[p.id] = sameTimeline
      ? { ...previous.transport[p.id], disabled: false }
      : { offset: 0, anchor: p.start ?? clock, paused: false, disabled: false };
  }
  return { zone, placements, transport, revision: previous.revision + 1 };
}

export function createAdRenderer(id) {
  let plan = adPlan(id);
  let previous = '';
  const slots = [];
  const db = getSqliteDatabase();
  const lookup = db.prepare('SELECT data FROM ad_frames WHERE stationId=? AND asset=? AND frame=?');
  const assets = db.prepare('SELECT id,frames,kind FROM ad_assets WHERE stationId=?');
  let inventory;
  return {
    update(next) {
      plan = next;
      inventory = null;
      previous = '';
    },
    draw(wall, clock) {
      if (!inventory) inventory = new Map(assets.all(id).map((row) => [row.id, row]));
      const layers = [];
      for (const p of [...plan.placements].sort(placementOrder)) {
        const layer = adLayer(p, plan.transport[p.id], wall, clock);
        const asset = layer && inventory.get(layer.asset);
        if (!asset) {
          layers.push(null);
          continue;
        }
        const frame = Math.floor(layer.elapsed / 80) % asset.frames;
        layers.push({
          placement: p.id,
          key: asset.id + '/' + frame,
          asset: asset.id,
          frame,
          kind: asset.kind,
          x: Math.round((layer.x * PROGRAM_CANVAS.width) / 100),
          y: Math.round((layer.y * PROGRAM_CANVAS.height) / 100),
          w: Math.max(1, Math.round((layer.w * PROGRAM_CANVAS.width) / 100)),
          h: Math.max(1, Math.round((layer.h * PROGRAM_CANVAS.height) / 100)),
          alpha: Math.round(layer.alpha * 1000) / 1000
        });
      }
      const signature = JSON.stringify([plan.revision, layers]);
      if (signature === previous) return null;
      previous = signature;
      layers.forEach((layer, index) => {
        if (!layer) return;
        if (slots[index] !== layer.key) {
          const row = lookup.get(id, layer.asset, layer.frame);
          layer.bitmap = row ? Buffer.from(row.data).toString('base64') : '';
          slots[index] = layer.key;
        }
      });
      slots.length = layers.length;
      return { adLayers: layers, revision: plan.revision };
    }
  };
}
