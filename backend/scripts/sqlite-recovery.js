/** Host-side SQLite backup/restore. The destination must be a fresh file. */
import { backup, DatabaseSync } from 'node:sqlite';
import { link, mkdtemp, open, realpath, rmdir, stat, unlink } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

function openMcrDatabase(path, readOnly = true) {
  const db = new DatabaseSync(path, { readOnly });
  try {
    db.exec('PRAGMA trusted_schema=OFF; PRAGMA busy_timeout=3000;');
    const schema = db.prepare("SELECT count(*) AS count FROM sqlite_schema WHERE type='table' AND name IN ('stations','users','program_ads','program_watermarks')").get();
    if (schema.count !== 4) throw Error('Source does not contain the MCR SQLite schema');
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

async function rotateStationPasswords(path, { currentKey, nextKey }) {
  const { CryptoService } = await import('../src/infrastructure/security/crypto-service.js');
  const db = openMcrDatabase(path, false);
  try {
    db.exec('PRAGMA journal_mode=DELETE; PRAGMA secure_delete=ON; BEGIN IMMEDIATE;');
    const stations = db.prepare("SELECT id, encryptedPassword FROM stations WHERE encryptedPassword IS NOT NULL AND encryptedPassword <> ''").all();
    const update = db.prepare('UPDATE stations SET encryptedPassword=? WHERE id=?');
    for (const station of stations) {
      const password = CryptoService.decryptSecret(station.encryptedPassword, currentKey);
      const replacement = CryptoService.encryptSecret(password, nextKey);
      update.run(replacement, station.id);
    }
    db.exec('COMMIT');
  } catch {
    // Closing the staging database rolls back any unfinished transaction.
    throw Error('Unable to rotate station encryption on the copy. Verify the current key and source database.');
  } finally {
    db.close();
  }
}

export async function copyMcrDatabase(source, destination, rotation) {
  if (rotation) {
    const validKey = key => typeof key === 'string' && /^[a-f0-9]{64}$/i.test(key);
    if (!validKey(rotation.currentKey) || !validKey(rotation.nextKey) ||
        rotation.currentKey.toLowerCase() === rotation.nextKey.toLowerCase()) {
      throw Error('Rotation requires two different 64-character hexadecimal keys.');
    }
  }
  const sourcePath = await realpath(source);
  if (!(await stat(sourcePath)).isFile()) throw Error('Source must be an MCR SQLite file');
  const destinationPath = resolve(destination);
  const parent = await realpath(dirname(destinationPath));
  const target = join(parent, basename(destinationPath));
  const temp = await mkdtemp(join(parent, '.mcr-snapshot-'));
  const staging = join(temp, 'archive.sqlite');
  try {
    await (await open(staging, 'wx', 0o600)).close();
    const original = openMcrDatabase(sourcePath);
    try {
      await backup(original, staging, { rate:128 });
    } finally {
      original.close();
    }
    if (rotation) await rotateStationPasswords(staging, rotation);
    const copy = openMcrDatabase(staging);
    try {
      const result = copy.prepare('PRAGMA integrity_check').all();
      if (result.length !== 1 || result[0].integrity_check !== 'ok') throw Error('SQLite integrity check failed');
    } finally {
      copy.close();
    }
    // Publish the complete verified file without overwriting any existing path.
    await link(staging, target);
  } finally {
    for (const name of ['archive.sqlite', 'archive.sqlite-journal', 'archive.sqlite-shm', 'archive.sqlite-wal']) {
      await unlink(join(temp, name)).catch(() => {});
    }
    await rmdir(temp).catch(() => {});
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const [mode, source, destination, extra] = process.argv.slice(2);
  if (!['backup', 'restore', 'rekey'].includes(mode) || !source || !destination || extra !== undefined) {
    console.error('Usage: node backend/scripts/sqlite-recovery.js <backup|restore|rekey> <source> <new-destination>');
    process.exitCode = 2;
  } else {
    try {
      const rotation = mode === 'rekey' ? {
        currentKey: process.env.MCR_REKEY_CURRENT,
        nextKey: process.env.MCR_REKEY_NEXT
      } : undefined;
      await copyMcrDatabase(source, destination, rotation);
      console.log(mode === 'rekey' ? 'Verified SQLite copy with rotated station encryption created'
        : mode === 'backup' ? 'Verified SQLite backup created' : 'Verified SQLite restored to a fresh file');
    } catch (error) {
      console.error(error.code === 'EEXIST' ? 'Destination already exists' : error.message);
      process.exitCode = 1;
    }
  }
}
