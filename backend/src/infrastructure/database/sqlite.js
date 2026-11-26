import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { env } from '../../config/env.js';

let dbInstance = null;

export function getSqliteDatabase() {
  if (dbInstance) return dbInstance;

  const dbPath = path.resolve(process.cwd(), env.SQLITE_DB_PATH);
  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  dbInstance = new DatabaseSync(dbPath);
  dbInstance.exec('PRAGMA busy_timeout = 3000');

  // Initialize SQLite tables matching the domain schema
  dbInstance.exec(`
    CREATE TABLE IF NOT EXISTS organizations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      passwordHash TEXT NOT NULL,
      fullName TEXT NOT NULL,
      isActive INTEGER DEFAULT 1,
      role TEXT DEFAULT 'OPERATOR',
      organizationId TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS studios (
      id TEXT PRIMARY KEY,
      organizationId TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS stations (
      id TEXT PRIMARY KEY,
      organizationId TEXT NOT NULL,
      studioId TEXT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      description TEXT,
      ipAddress TEXT DEFAULT '127.0.0.1',
      obsPort INTEGER DEFAULT 4455,
      encryptedPassword TEXT,
      status TEXT DEFAULT 'OFFLINE',
      streamStatus TEXT DEFAULT 'STOPPED',
      recordStatus TEXT DEFAULT 'STOPPED',
      currentProgramScene TEXT,
      currentPreviewScene TEXT,
      fps REAL DEFAULT 0.0,
      cpuUsage REAL DEFAULT 0.0,
      memoryUsage REAL DEFAULT 0.0,
      droppedFrames INTEGER DEFAULT 0,
      lastHeartbeat TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pairing_tokens (
      id TEXT PRIMARY KEY,
      stationId TEXT NOT NULL,
      pairingCode TEXT NOT NULL,
      tokenHash TEXT NOT NULL,
      expiresAt TEXT NOT NULL,
      usedAt TEXT,
      createdByUserId TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS station_agent_credentials (
      stationId TEXT PRIMARY KEY REFERENCES stations(id) ON DELETE CASCADE,
      generation INTEGER NOT NULL CHECK(generation > 0)
    );

    CREATE TABLE IF NOT EXISTS station_automations (
      id TEXT PRIMARY KEY, organizationId TEXT NOT NULL, userId TEXT NOT NULL,
      stationId TEXT NOT NULL, name TEXT NOT NULL, action TEXT NOT NULL, sceneName TEXT,
      runAt TEXT, status TEXT NOT NULL, error TEXT
    );

    CREATE TABLE IF NOT EXISTS station_graphics_tokens (
      stationId TEXT PRIMARY KEY, token TEXT NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS station_graphics (
      stationId TEXT NOT NULL, kind TEXT NOT NULL, content TEXT NOT NULL,
      image TEXT NOT NULL, imageRevision TEXT NOT NULL,
      published INTEGER NOT NULL DEFAULT 0, expiresAt INTEGER,
      PRIMARY KEY (stationId, kind)
    );

    CREATE TABLE IF NOT EXISTS program_resume_source (
      stationId TEXT PRIMARY KEY REFERENCES stations(id) ON DELETE CASCADE, selection TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS program_named_scenes (
      stationId TEXT NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
      id TEXT NOT NULL, scene TEXT NOT NULL, PRIMARY KEY (stationId,id)
    );
    CREATE TABLE IF NOT EXISTS program_local_scenes (
      stationId TEXT PRIMARY KEY REFERENCES stations(id) ON DELETE CASCADE, scene TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS program_ads (stationId TEXT PRIMARY KEY, plan TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS ad_asset_audio (
      stationId TEXT NOT NULL, asset TEXT NOT NULL, pcm BLOB NOT NULL,
      PRIMARY KEY (stationId, asset),
      FOREIGN KEY (stationId, asset) REFERENCES ad_assets(stationId,id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS ad_assets (
      stationId TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL,
      frames INTEGER NOT NULL, media BLOB NOT NULL, PRIMARY KEY(stationId,id)
    );
    CREATE TABLE IF NOT EXISTS ad_frames (
      stationId TEXT NOT NULL, asset TEXT NOT NULL, frame INTEGER NOT NULL, data BLOB NOT NULL,
      PRIMARY KEY(stationId,asset,frame)
    );
    CREATE TABLE IF NOT EXISTS program_watermarks (
      stationId TEXT PRIMARY KEY, revision INTEGER NOT NULL, settings TEXT NOT NULL, bitmap TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS program_tickers (
      stationId TEXT PRIMARY KEY REFERENCES stations(id) ON DELETE CASCADE,
      revision INTEGER NOT NULL, settings TEXT NOT NULL, bitmap TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS station_playout (
      stationId TEXT PRIMARY KEY, plan TEXT NOT NULL, state TEXT NOT NULL,
      assets TEXT NOT NULL DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS playout_as_run (
      id TEXT PRIMARY KEY, stationId TEXT NOT NULL, itemId TEXT NOT NULL,
      title TEXT NOT NULL, category TEXT NOT NULL, sceneName TEXT, plannedAt INTEGER,
      startedAt INTEGER, endedAt INTEGER, outcome TEXT NOT NULL, detail TEXT
    );
    CREATE INDEX IF NOT EXISTS playout_as_run_station ON playout_as_run (stationId, startedAt DESC);

    CREATE TABLE IF NOT EXISTS auth_sessions (
      id TEXT PRIMARY KEY, userId TEXT NOT NULL, refreshHash TEXT NOT NULL, expiresAt INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS auth_sessions_expiry ON auth_sessions(expiresAt);
    CREATE TRIGGER IF NOT EXISTS revoke_auth_sessions_on_account_change
    AFTER UPDATE OF isActive, passwordHash ON users
    WHEN NEW.isActive = 0 OR NEW.passwordHash IS NOT OLD.passwordHash
    BEGIN
      DELETE FROM auth_sessions WHERE userId = NEW.id;
    END;

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      organizationId TEXT NOT NULL,
      userId TEXT,
      action TEXT NOT NULL,
      resourceType TEXT NOT NULL,
      resourceId TEXT,
      details TEXT,
      ipAddress TEXT,
      createdAt TEXT NOT NULL
    );
  `);

  return dbInstance;
}
