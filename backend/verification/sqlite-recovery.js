import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { copyMcrDatabase } from '../scripts/sqlite-recovery.js';

const directory = mkdtempSync(join(tmpdir(), 'mcr-recovery-fixture-'));
const live = join(directory, 'live.sqlite');
const archive = join(directory, 'archive.sqlite');
const replacement = join(directory, 'test-restore.sqlite');
Object.assign(process.env, { NODE_ENV:'test', SQLITE_DB_PATH:live, STORAGE_MODE:'sqlite' });
const { getSqliteDatabase } = await import('../src/infrastructure/database/sqlite.js');
const { RepositoryFactory: repo } = await import('../src/infrastructure/repositories/repository-factory.js');
const source = getSqliteDatabase();
source.exec('PRAGMA journal_mode=WAL');
const { id } = await repo.getStationRepository().create({ name:'Before backup', organizationId:'fixture', encryptedPassword:'unused' });
source.prepare('INSERT INTO program_ads VALUES (?, ?)').run(id, '{"revision":2}');
source.prepare('INSERT INTO program_watermarks (stationId, settings, bitmap, revision) VALUES (?, ?, ?, ?)')
  .run(id, '{"enabled":true}', 'fixture-bitmap', 1);
const media = Buffer.alloc(1024 * 1024, 0x6a);
source.prepare('INSERT INTO ad_assets VALUES (?, ?, ?, ?, ?, ?)').run(id, 'creative', 'fixture.png', 'image', 1, media);
source.prepare('INSERT INTO ad_frames VALUES (?, ?, ?, ?)').run(id, 'creative', 0, media);
source.exec('BEGIN IMMEDIATE');
source.prepare('UPDATE stations SET name=? WHERE id=?').run('Uncommitted update', id);
await copyMcrDatabase(live, archive);
source.exec('COMMIT');
source.prepare('DELETE FROM ad_frames WHERE stationId=?').run(id);
assert.equal(source.prepare('SELECT name FROM stations WHERE id=?').get(id).name, 'Uncommitted update');

const cli = fileURLToPath(new URL('../scripts/sqlite-recovery.js', import.meta.url));
const child = spawnSync(process.execPath, [cli, 'restore', archive, replacement],
  { encoding:'utf8', windowsHide:true });
assert.equal(child.status, 0, child.stderr);
const restored = new DatabaseSync(replacement, { readOnly:true });
try {
  assert.equal(restored.prepare('SELECT name FROM stations WHERE id=?').get(id).name, 'Before backup');
  assert.equal(restored.prepare('SELECT revision FROM program_watermarks WHERE stationId=?').get(id).revision, 1);
  assert.equal(restored.prepare('SELECT plan FROM program_ads WHERE stationId=?').get(id).plan, '{"revision":2}');
  assert.deepEqual(Buffer.from(restored.prepare('SELECT data FROM ad_frames WHERE stationId=?').get(id).data), media);
} finally {
  restored.close();
}
await assert.rejects(copyMcrDatabase(archive, live), { code:'EEXIST' });
assert.equal(source.prepare('SELECT name FROM stations WHERE id=?').get(id).name, 'Uncommitted update');
source.close();

const unrelated = join(directory, 'unrelated.sqlite');
writeFileSync(unrelated, 'not SQLite');
await assert.rejects(copyMcrDatabase(unrelated, join(directory, 'bad-backup.sqlite')));
assert(!readdirSync(directory).includes('bad-backup.sqlite'));
assert(!readdirSync(directory).some(name => name.startsWith('.mcr-snapshot-')));
console.log('SQLite online backup and isolated restore passed');
