import { CryptoService } from '../../src/infrastructure/security/crypto-service.js';
import { getSqliteDatabase } from '../../src/infrastructure/database/sqlite.js';

async function seed() {
  const adminPassword = process.env.MCR_ADMIN_PASSWORD;
  const operatorPassword = process.env.MCR_SEED_OPERATOR_PASSWORD;
  if (adminPassword?.length < 12 || !adminPassword || operatorPassword?.length < 12 || !operatorPassword) {
    throw new Error('Set MCR_ADMIN_PASSWORD and MCR_SEED_OPERATOR_PASSWORD to at least 12 characters');
  }
  console.log('[MCR PRO Seed] Initializing database seed...');
  const db = getSqliteDatabase();
  const now = new Date().toISOString();

  // 1. Seed Organization
  const orgStmt = db.prepare(`
    INSERT OR IGNORE INTO organizations (id, name, slug, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?)
  `);
  orgStmt.run('org-mcr-network', 'MCR Global Broadcast Network', 'mcr-global', now, now);

  // 2. Seed Super Administrator
  const userStmt = db.prepare(`
    INSERT OR IGNORE INTO users (id, email, passwordHash, fullName, isActive, role, organizationId, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const adminHash = await CryptoService.hashPassword(adminPassword);
  userStmt.run(
    'usr-admin-1',
    'admin@mcrpro.local',
    adminHash,
    'System Super Administrator',
    1,
    'SUPER_ADMIN',
    'org-mcr-network',
    now,
    now
  );

  // 3. Seed Operator
  const opHash = await CryptoService.hashPassword(operatorPassword);
  userStmt.run(
    'usr-op-1',
    'operator@mcrpro.local',
    opHash,
    'Live Deck Operator',
    1,
    'OPERATOR',
    'org-mcr-network',
    now,
    now
  );

  // 4. Seed Stations
  const stationStmt = db.prepare(`
    INSERT OR IGNORE INTO stations (
      id, organizationId, studioId, name, slug, description,
      ipAddress, obsPort, encryptedPassword, status, streamStatus,
      recordStatus, currentProgramScene, currentPreviewScene,
      fps, cpuUsage, memoryUsage, droppedFrames, lastHeartbeat,
      createdAt, updatedAt
    ) VALUES (
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?
    )
  `);

  stationStmt.run(
    'station-01',
    'org-mcr-network',
    'studio-a',
    'Main Studio A — Master OBS',
    'main-studio-a',
    'Primary live broadcast switching station',
    '127.0.0.1',
    4455,
    CryptoService.encryptSecret('ObsStudioSecretPassword!'),
    'ONLINE',
    'STREAMING',
    'RECORDING',
    'Host & Guest Split',
    'Presenter Close-up (Cam 1)',
    59.94,
    14.8,
    38.2,
    0,
    now,
    now,
    now
  );

  stationStmt.run(
    'station-02',
    'org-mcr-network',
    'studio-b',
    'Studio B — News Bulletin OBS',
    'studio-b-news',
    'Secondary newsroom bulletin station',
    '127.0.0.1',
    4455,
    CryptoService.encryptSecret('ObsStudioSecretPassword!'),
    'ONLINE',
    'STOPPED',
    'STOPPED',
    'News Desk Wide',
    'Weather Chroma Key',
    60.0,
    9.4,
    26.5,
    0,
    now,
    now,
    now
  );

  console.log('[MCR PRO Seed] Database seed completed successfully!');
}

seed().catch((err) => {
  console.error('[MCR PRO Seed] Seeding error:', err);
  process.exit(1);
});
