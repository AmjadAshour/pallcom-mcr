import { randomUUID } from 'node:crypto';
import { env } from '../../config/env.js';

let preparing = false;

export function reserveCreativeUpload() {
  if (preparing) throw Object.assign(new Error('Another media upload is being prepared'), { statusCode: 409 });
  preparing = true;
  return () => { preparing = false; };
}

// The caller includes this write and its audit event in a transaction.
export function storeCreative(db, stationId, name, prepared) {
  const { total } = db.prepare('SELECT count(*) AS total FROM ad_assets WHERE stationId=?').get(stationId);
  if (total >= 32) throw Object.assign(new Error('Media library is full (32 files)'), { statusCode: 409 });
  const { bytes } = db.prepare(`
    SELECT COALESCE((SELECT SUM(length(media)) FROM ad_assets WHERE stationId = ?), 0)
      + COALESCE((SELECT SUM(length(data)) FROM ad_frames WHERE stationId = ?), 0)
      + COALESCE((SELECT SUM(length(pcm)) FROM ad_asset_audio WHERE stationId = ?), 0) AS bytes
  `).get(stationId, stationId, stationId);
  const newBytes = prepared.media.byteLength + (prepared.pcm?.byteLength ?? 0)
    + prepared.frames.reduce((total, frame) => total + frame.byteLength, 0);
  if (bytes + newBytes > env.MEDIA_STATION_QUOTA_BYTES) {
    throw Object.assign(new Error('This upload would exceed the station media storage quota.'), { statusCode: 409 });
  }
  const id = randomUUID();
  db.prepare('INSERT INTO ad_assets VALUES (?,?,?,?,?,?)')
    .run(stationId, id, name, prepared.kind, prepared.frames.length, prepared.media);
  const insert = db.prepare('INSERT INTO ad_frames VALUES (?,?,?,?)');
  prepared.frames.forEach((frame, index) => insert.run(stationId, id, index, frame));
  if (prepared.pcm?.length) db.prepare('INSERT INTO ad_asset_audio VALUES (?,?,?)').run(stationId, id, prepared.pcm);
  return { id, name, kind: prepared.kind, frames: prepared.frames.length };
}
