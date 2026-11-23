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
