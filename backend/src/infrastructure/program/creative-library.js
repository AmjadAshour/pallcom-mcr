import { randomUUID } from 'node:crypto';

// The caller includes this write and its audit event in a transaction.
export function storeCreative(db, stationId, name, prepared) {
  const { total } = db.prepare('SELECT count(*) AS total FROM ad_assets WHERE stationId=?').get(stationId);
  if (total >= 32) throw Object.assign(new Error('Media library is full (32 files)'), { statusCode: 409 });
  const id = randomUUID();
  db.prepare('INSERT INTO ad_assets VALUES (?,?,?,?,?,?)')
    .run(stationId, id, name, prepared.kind, prepared.frames.length, prepared.media);
  const insert = db.prepare('INSERT INTO ad_frames VALUES (?,?,?,?)');
  prepared.frames.forEach((frame, index) => insert.run(stationId, id, index, frame));
  if (prepared.pcm?.length) db.prepare('INSERT INTO ad_asset_audio VALUES (?,?,?)').run(stationId, id, prepared.pcm);
  return { id, name, kind: prepared.kind, frames: prepared.frames.length };
}
