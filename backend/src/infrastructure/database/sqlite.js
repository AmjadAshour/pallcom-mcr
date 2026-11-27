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

    CREATE TABLE IF NOT EXISTS program_station_selection (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      stationId TEXT NOT NULL
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
      stationId TEXT PRIMARY KEY, token TEXT NOT NULL UNIQUE, expiresAt INTEGER
    );

    CREATE TABLE IF NOT EXISTS station_graphics (
      stationId TEXT NOT NULL, kind TEXT NOT NULL, content TEXT NOT NULL,
      image TEXT NOT NULL, imageRevision TEXT NOT NULL,
      published INTEGER NOT NULL DEFAULT 0, expiresAt INTEGER,
      PRIMARY KEY (stationId, kind)
    );

    CREATE TABLE IF NOT EXISTS program_schedule (
      id TEXT PRIMARY KEY, stationId TEXT NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
      userId TEXT NOT NULL, sceneId TEXT NOT NULL, scene TEXT NOT NULL,
      dueAt INTEGER NOT NULL, state TEXT NOT NULL, executedAt INTEGER, error TEXT,
      UNIQUE(stationId,dueAt)
    );
    CREATE TABLE IF NOT EXISTS program_schedule_hold (
      stationId TEXT PRIMARY KEY REFERENCES stations(id) ON DELETE CASCADE, resumedAt INTEGER
    );
    CREATE TABLE IF NOT EXISTS program_schedule_daily (
      jobId TEXT PRIMARY KEY REFERENCES program_schedule(id) ON DELETE CASCADE
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
    CREATE INDEX IF NOT EXISTS auth_sessions_user ON auth_sessions(userId);
    CREATE TRIGGER IF NOT EXISTS revoke_auth_sessions_on_account_change
    AFTER UPDATE OF isActive, passwordHash ON users
    WHEN NEW.isActive = 0 OR NEW.passwordHash IS NOT OLD.passwordHash
    BEGIN
      DELETE FROM auth_sessions WHERE userId = NEW.id;
    END;

    CREATE TABLE IF NOT EXISTS password_reset_grants (
      userId TEXT PRIMARY KEY, tokenHash TEXT NOT NULL UNIQUE, expiresAt INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS password_reset_grants_expiry ON password_reset_grants(expiresAt);
    CREATE TRIGGER IF NOT EXISTS revoke_password_reset_on_account_change
    AFTER UPDATE OF isActive, passwordHash ON users
    WHEN NEW.isActive = 0 OR NEW.passwordHash IS NOT OLD.passwordHash
    BEGIN
      DELETE FROM password_reset_grants WHERE userId = NEW.id;
    END;
    CREATE TABLE IF NOT EXISTS auth_mfa (
      userId TEXT PRIMARY KEY, encryptedSecret TEXT NOT NULL, enabled INTEGER NOT NULL,
      pendingUntil INTEGER NOT NULL, lastStep INTEGER NOT NULL DEFAULT -1
    );
    CREATE TABLE IF NOT EXISTS auth_mfa_recovery_codes (
      userId TEXT NOT NULL, codeHash TEXT NOT NULL, PRIMARY KEY (userId, codeHash)
    );

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

  const graphicsHasExpiry = () => dbInstance.prepare('PRAGMA table_info(station_graphics_tokens)')
    .all().some(column => column.name === 'expiresAt');
  try {
    if (!graphicsHasExpiry()) {
      dbInstance.exec('BEGIN IMMEDIATE');
      try {
        if (!graphicsHasExpiry()) dbInstance.exec('ALTER TABLE station_graphics_tokens ADD COLUMN expiresAt INTEGER');
        dbInstance.exec('COMMIT');
      } catch (error) {
        dbInstance.exec('ROLLBACK');
        throw error;
      }
    }
  } catch (error) {
    dbInstance.close();
    dbInstance = null;
    throw error;
  }

  return dbInstance;
}
