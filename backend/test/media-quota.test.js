import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

test('station quota counts existing preview, frames and audio and permits an exact fit', async () => {
  process.env.NODE_ENV = 'test';
  process.env.STORAGE_MODE = 'sqlite';
  process.env.MCR_MEDIA_STATION_QUOTA_MIB = '1';
  process.env.SQLITE_DB_PATH = join(mkdtempSync(join(tmpdir(), 'mcr-quota-')), 'test.sqlite');
  const { getSqliteDatabase } = await import('../src/infrastructure/database/sqlite.js');
  const { storeCreative } = await import('../src/infrastructure/program/creative-library.js');
  const db = getSqliteDatabase();
  try {
    db.prepare('INSERT INTO ad_assets VALUES (?,?,?,?,?,?)')
      .run('station-a', 'legacy', 'Old clip', 'video', 1, Buffer.alloc(512 * 1024));
    db.prepare('INSERT INTO ad_frames VALUES (?,?,?,?)')
      .run('station-a', 'legacy', 0, Buffer.alloc(256 * 1024));
    db.prepare('INSERT INTO ad_asset_audio VALUES (?,?,?)')
      .run('station-a', 'legacy', Buffer.alloc(128 * 1024));

    function save(stationId, name, media) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const asset = storeCreative(db, stationId, name, media);
        db.exec('COMMIT');
        return asset;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    }

    const exactFit = { kind: 'video', media: Buffer.alloc(80 * 1024),
      frames: [Buffer.alloc(32 * 1024)], pcm: Buffer.alloc(16 * 1024) };
    const small = { kind: 'image', media: Buffer.alloc(1), frames: [Buffer.alloc(1)] };
    assert.throws(() => save('station-a', 'Too large', {
      ...exactFit, pcm: Buffer.alloc(16 * 1024 + 1)
    }), { statusCode: 409 });
    assert.equal(db.prepare('SELECT count(*) AS total FROM ad_assets').get().total, 1);
    assert.equal(save('station-a', 'Exact fit', exactFit).kind, 'video');
    assert.throws(() => save('station-a', 'No space', small), { statusCode: 409 });
    assert.equal(save('station-b', 'Isolated quota', small).kind, 'image');

    db.prepare('DELETE FROM ad_frames WHERE stationId=? AND asset=?').run('station-a', 'legacy');
    db.prepare('DELETE FROM ad_assets WHERE stationId=? AND id=?').run('station-a', 'legacy');
    assert.equal(save('station-a', 'Space reclaimed', small).kind, 'image');
  } finally {
    db.close();
  }
});
