import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
const projectRoot = fileURLToPath(new URL('../../../', import.meta.url));
dotenv.config({ path: path.join(projectRoot, '.env') });

const developmentSecrets = {
  JWT_SECRET: 'mcr_pro_development_jwt_secret_must_change_in_production_32bytes!',
  REFRESH_TOKEN_SECRET: 'mcr_pro_development_refresh_secret_must_change_in_production_32bytes!',
  ENCRYPTION_MASTER_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
};

const bindHost = process.env.MCR_BIND_HOST || '127.0.0.1';
const requiresPrivateSecrets = process.env.NODE_ENV === 'production' ||
  !['localhost', '127.0.0.1', '::1'].includes(bindHost);

if (requiresPrivateSecrets) {
  for (const [name, fallback] of Object.entries(developmentSecrets)) {
    const value = process.env[name];
    const valid = name === 'ENCRYPTION_MASTER_KEY' ? /^[a-f0-9]{64}$/i.test(value ?? '') : (value?.trim().length ?? 0) >= 32;
    if (!valid || value.toLowerCase() === fallback.toLowerCase() || /^(change_me|super_secret_)/i.test(value)) {
      throw new Error(`Set a private ${name} before running MCR in production or binding to the network.`);
    }
  }
  if (process.env.JWT_SECRET === process.env.REFRESH_TOKEN_SECRET) {
    throw new Error('JWT_SECRET and REFRESH_TOKEN_SECRET must be different.');
  }
}

if (process.env.NODE_ENV === 'production') {
  const origin = URL.parse(process.env.CORS_ORIGIN ?? '');
  if (origin?.protocol !== 'https:' || origin.origin !== process.env.CORS_ORIGIN) {
    throw new Error('Set CORS_ORIGIN to the exact public HTTPS origin.');
  }
}

export const env = Object.freeze({
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT || '4000', 10),
  APP_NAME: process.env.APP_NAME || 'PALLCOM MCR',
  APP_URL: process.env.APP_URL || 'http://localhost:4000',
  CORS_ORIGIN: process.env.CORS_ORIGIN || 'http://localhost:5173',
  STORAGE_MODE: process.env.STORAGE_MODE || (process.env.DATABASE_URL ? 'mysql' : 'sqlite'),
  DATABASE_URL: process.env.DATABASE_URL || '',
  SQLITE_DB_PATH: path.resolve(projectRoot, process.env.SQLITE_DB_PATH || 'backend/database/sqlite/mcr_local.db'),
  JWT_SECRET: process.env.JWT_SECRET || developmentSecrets.JWT_SECRET,
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '15m',
  REFRESH_TOKEN_SECRET: process.env.REFRESH_TOKEN_SECRET || developmentSecrets.REFRESH_TOKEN_SECRET,
  REFRESH_TOKEN_EXPIRES_IN: process.env.REFRESH_TOKEN_EXPIRES_IN || '7d',
  ENCRYPTION_MASTER_KEY: process.env.ENCRYPTION_MASTER_KEY || developmentSecrets.ENCRYPTION_MASTER_KEY,
  AGENT_REGISTRATION_SECRET: process.env.AGENT_REGISTRATION_SECRET || 'mcr_agent_shared_pairing_secret_key',
  LOG_LEVEL: process.env.LOG_LEVEL || 'info'
});
