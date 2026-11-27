import dotenv from 'dotenv';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { isIP } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../../../', import.meta.url));
dotenv.config({ path: path.join(projectRoot, 'backend', '.env') });
// Retain the historical root location for existing local and Compose installations.
dotenv.config({ path: path.join(projectRoot, '.env') });

const secretVariables = ['JWT_SECRET', 'REFRESH_TOKEN_SECRET', 'ENCRYPTION_MASTER_KEY'];
// Fingerprints reject the previously published defaults without retaining those values.
const exposedDevelopmentDigests = new Set([
  '7ed8435b8d691a7df0eb1828c3e7eb5816c752d745807b31bf4af366c83773f1',
  '963f2c463f78903c881adc48735e3782bcca28c263e23a0e07a68dcbded921c1',
  'a8ae6e6ee929abea3afcfc5258c8ccd6f85273e0d4626d26c7279f3250f77c8e',
]);
const developmentSecrets = Object.fromEntries(secretVariables
  .map(name => [name, randomBytes(32).toString('hex')]));

export function isExposedBootstrapPassword(password) {
  return typeof password === 'string' && createHash('sha256').update(password.trim()).digest('hex') ===
    'db735458867474ed3163fd668a7324d4c03853bec77d1ab3dc2f070ad92d80dc';
}

const bindHost = process.env.MCR_BIND_HOST || '127.0.0.1';
const onRender = process.env.RENDER === 'true';
const renderOrigin = onRender ? process.env.RENDER_EXTERNAL_URL : undefined;
const corsOrigin = process.env.CORS_ORIGIN || renderOrigin;
const requiresPrivateSecrets = process.env.NODE_ENV === 'production' ||
  !['localhost', '127.0.0.1', '::1'].includes(bindHost);

if (requiresPrivateSecrets) {
  for (const name of secretVariables) {
    const value = process.env[name];
    const valid = name === 'ENCRYPTION_MASTER_KEY' ? /^[a-f0-9]{64}$/i.test(value ?? '') : (value?.trim().length ?? 0) >= 32;
    if (!valid || exposedDevelopmentDigests.has(createHash('sha256').update(value.toLowerCase()).digest('hex')) || /^(change_me|super_secret_)/i.test(value)) {
      throw new Error(`Set a private ${name} before running MCR in production or binding to the network.`);
    }
  }
  const keys = secretVariables.map(name => process.env[name].trim().toLowerCase());
  if (new Set(keys).size !== keys.length) {
    throw new Error('JWT_SECRET, REFRESH_TOKEN_SECRET and ENCRYPTION_MASTER_KEY must be distinct.');
  }
  const bootstrapPassword = process.env.MCR_ADMIN_PASSWORD;
  if (bootstrapPassword && (bootstrapPassword.trim().length < 12 ||
      isExposedBootstrapPassword(bootstrapPassword))) {
    throw new Error('Set a private MCR_ADMIN_PASSWORD or omit it on network-bound installations.');
  }
}

if (process.env.NODE_ENV === 'production') {
  const origin = URL.parse(corsOrigin ?? '');
  if (origin?.protocol !== 'https:' || origin.origin !== corsOrigin) {
    throw new Error('Set CORS_ORIGIN to the exact public HTTPS origin.');
  }
}

const mediaQuotaMiB = process.env.MCR_MEDIA_STATION_QUOTA_MIB ?? '512';
if (!/^\d+$/.test(mediaQuotaMiB) || Number(mediaQuotaMiB) < 1 || Number(mediaQuotaMiB) > 16384) {
  throw new Error('MCR_MEDIA_STATION_QUOTA_MIB must be a whole number from 1 to 16384.');
}

const proxyAddresses = process.env.MCR_TRUST_PROXY_CIDRS?.trim();
const trustedProxies = proxyAddresses ? proxyAddresses.split(',').map(value => value.trim()) : [];
for (const entry of trustedProxies) {
  const [, address, prefix] = /^([^/%]+)(?:\/([1-9][0-9]{0,2}))?$/.exec(entry) ?? [];
  const family = isIP(address ?? '');
  if (!family || (prefix !== undefined && Number(prefix) > (family === 4 ? 32 : 128))) {
    throw new Error('MCR_TRUST_PROXY_CIDRS must list IP addresses or nonzero CIDR subnets.');
  }
}

const sqliteDbPath = path.resolve(projectRoot, process.env.SQLITE_DB_PATH || 'backend/database/sqlite/mcr_local.db');
const storageMode = process.env.STORAGE_MODE || (process.env.DATABASE_URL ? 'mysql' : 'sqlite');
if (storageMode !== 'sqlite') {
  throw new Error('The MCR runtime supports only SQLite. Set STORAGE_MODE=sqlite and a protected SQLITE_DB_PATH.');
}
const renderDisk = onRender ? process.env.MCR_RENDER_DISK_MOUNT : undefined;
if (renderDisk) {
  if (!/^\/[A-Za-z0-9/_-]+$/.test(renderDisk) || !process.env.SQLITE_DB_PATH) {
    throw new Error('Set MCR_RENDER_DISK_MOUNT and SQLITE_DB_PATH to absolute Render disk paths.');
  }
  const mount = path.resolve(renderDisk);
  if (!sqliteDbPath.startsWith(mount + path.sep)) {
    throw new Error('SQLITE_DB_PATH must be below MCR_RENDER_DISK_MOUNT.');
  }
  const mounts = readFileSync('/proc/self/mountinfo', 'utf8').split('\n');
  if (!mounts.some((entry) => entry.split(' ')[4] === mount) || realpathSync(mount) !== mount) {
    throw new Error('The configured Render persistent disk is not mounted.');
  }
}

const recoveryUrl = process.env.MCR_PASSWORD_RESET_DELIVERY_URL;
const recoveryKey = process.env.MCR_PASSWORD_RESET_DELIVERY_KEY;
if (recoveryUrl || recoveryKey) {
  const delivery = URL.parse(recoveryUrl ?? '');
  const publicOrigin = URL.parse(corsOrigin ?? '');
  if (!delivery || delivery.protocol !== 'http:' || delivery.hostname !== '127.0.0.1' || !delivery.port ||
      delivery.username || delivery.password || delivery.search || delivery.hash ||
      !/^[a-f0-9]{64}$/i.test(recoveryKey ?? '') || !publicOrigin || publicOrigin.origin !== corsOrigin ||
      (publicOrigin.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' &&
        publicOrigin.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(publicOrigin.hostname)))) {
    throw new Error('Password recovery requires an exact application origin and an authenticated loopback delivery service.');
  }
}

export const env = Object.freeze({
  REQUIRE_PRIVATE_SECRETS: requiresPrivateSecrets,
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT || '4000', 10),
  APP_NAME: process.env.APP_NAME || 'PALLCOM MCR',
  APP_URL: process.env.APP_URL || renderOrigin || 'http://localhost:4000',
  CORS_ORIGIN: corsOrigin || 'http://localhost:5173',
  TRUST_PROXY: trustedProxies.length ? Object.freeze(trustedProxies) : process.env.MCR_TRUST_PROXY === '1' ? 1 : false,
  STORAGE_MODE: storageMode,
  DATABASE_URL: process.env.DATABASE_URL || '',
  SQLITE_DB_PATH: sqliteDbPath,
  MEDIA_STATION_QUOTA_BYTES: Number(mediaQuotaMiB) * 1024 ** 2,
  DEPLOYMENT_REVISION: onRender && /^[0-9a-f]{40}$/i.test(process.env.RENDER_GIT_COMMIT || '')
    ? process.env.RENDER_GIT_COMMIT : null,
  SQLITE_PERSISTENCE: onRender ? (renderDisk ? 'persistent-disk' : 'unverified') : 'local',
  JWT_SECRET: process.env.JWT_SECRET || developmentSecrets.JWT_SECRET,
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '15m',
  REFRESH_TOKEN_SECRET: process.env.REFRESH_TOKEN_SECRET || developmentSecrets.REFRESH_TOKEN_SECRET,
  REFRESH_TOKEN_EXPIRES_IN: process.env.REFRESH_TOKEN_EXPIRES_IN || '7d',
  ENCRYPTION_MASTER_KEY: process.env.ENCRYPTION_MASTER_KEY || developmentSecrets.ENCRYPTION_MASTER_KEY,
  PASSWORD_RESET_DELIVERY_URL: recoveryUrl,
  PASSWORD_RESET_DELIVERY_KEY: recoveryKey,
  LOG_LEVEL: process.env.LOG_LEVEL || 'info'
});
