import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const root = mkdtempSync(join(tmpdir(), 'mcr-rekey-fixture-'));
const source = join(root, 'before.sqlite');
const destination = join(root, 'after.sqlite');
const rejected = join(root, 'rejected.sqlite');
const currentKey = randomBytes(32).toString('hex');
const nextKey = randomBytes(32).toString('hex');
Object.assign(process.env, { NODE_ENV: 'test', SQLITE_DB_PATH: source, STORAGE_MODE: 'sqlite' });
const { getSqliteDatabase } = await import('../src/infrastructure/database/sqlite.js');
const { CryptoService } = await import('../src/infrastructure/security/crypto-service.js');

const db = getSqliteDatabase();
const password = 'Synthetic OBS media fixture';
const original = CryptoService.encryptSecret(password, currentKey);
db.prepare('INSERT INTO stations (id,organizationId,name,slug,encryptedPassword,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?)')
  .run('test-station', 'test-org', 'Station', 'station', original, new Date().toISOString(), new Date().toISOString());
db.prepare('INSERT INTO program_ads VALUES (?,?)').run('test-station', '{}');
db.close();

function rekey(target, from = currentKey, to = nextKey) {
  return spawnSync(process.execPath, ['backend/scripts/sqlite-recovery.js', 'rekey', source, target], {
    env: { ...process.env, MCR_REKEY_CURRENT: from, MCR_REKEY_NEXT: to },
    encoding: 'utf8'
  });
}

const rotated = rekey(destination);
assert.equal(rotated.status, 0, rotated.stderr);
const failed = rekey(rejected, randomBytes(32).toString('hex'));
assert.equal(failed.status, 1);
assert.equal(existsSync(rejected), false);
assert.equal(rekey(rejected, currentKey, currentKey).status, 1);
assert.equal(existsSync(rejected), false);
assert.equal(rekey(source).status, 1);
assert.equal(rekey(destination).status, 1);

const read = new DatabaseSync(destination, { readOnly: true });
const originalDb = new DatabaseSync(source, { readOnly: true });
try {
  const passwordColumn = 'SELECT encryptedPassword FROM stations WHERE id = ?';
  const rotatedPassword = read.prepare(passwordColumn).get('test-station').encryptedPassword;
  assert.equal(CryptoService.decryptSecret(rotatedPassword, nextKey), password);
  assert.throws(() => CryptoService.decryptSecret(rotatedPassword, currentKey));
  assert.equal(originalDb.prepare(passwordColumn).get('test-station').encryptedPassword, original);
  assert.equal(read.prepare('SELECT plan FROM program_ads WHERE stationId = ?').get('test-station').plan, '{}');
} finally {
  read.close();
  originalDb.close();
}

console.log('Offline station rekey copy, rejection and source preservation passed');
