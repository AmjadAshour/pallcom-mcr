import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import argon2 from 'argon2';
import { env } from '../../config/env.js';

export class CryptoService {
  /**
   * Hashes a password using Argon2id with broadcast-grade memory & iteration parameters
   */
  static async hashPassword(password) {
    return await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 2 ** 16, // 64 MB
      timeCost: 3,         // 3 iterations
      parallelism: 4
    });
  }

  /**
   * Verifies a password against an Argon2id hash
   */
  static async verifyPassword(hash, password) {
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }

  /**
   * AES-256-GCM Envelope Encryption for sensitive OBS passwords & device secrets
   * Format: iv:authTag:ciphertext in hex
   */
  static encryptSecret(plainText, masterKeyHex = env.ENCRYPTION_MASTER_KEY) {
    if (!plainText) return null;
    const key = Buffer.from(masterKeyHex.slice(0, 64), 'hex');
    const iv = crypto.randomBytes(12); // GCM recommended 96-bit IV
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

    let encrypted = cipher.update(plainText, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');

    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
  }

  /**
   * Decrypts an AES-256-GCM encrypted payload
   */
  static decryptSecret(cipherPayload, masterKeyHex = env.ENCRYPTION_MASTER_KEY) {
    if (!cipherPayload) return null;
    const parts = cipherPayload.split(':');
    if (parts.length !== 3) throw new Error('Invalid encrypted payload format');

    const [ivHex, authTagHex, encryptedHex] = parts;
    const key = Buffer.from(masterKeyHex.slice(0, 64), 'hex');
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  /**
   * Signs short-lived JWT Access Token
   */
  static signAccessToken(payload) {
    return jwt.sign(payload, env.JWT_SECRET, {
      expiresIn: env.JWT_EXPIRES_IN,
      issuer: 'MCR_PRO',
      audience: 'mcr_client'
    });
  }

  /**
   * Verifies Access Token
   */
  static verifyAccessToken(token) {
    return jwt.verify(token, env.JWT_SECRET, {
      issuer: 'MCR_PRO',
      audience: 'mcr_client'
    });
  }

  /**
   * Signs long-lived Refresh Token
   */
  static signRefreshToken(payload) {
    return jwt.sign(payload, env.REFRESH_TOKEN_SECRET, {
      expiresIn: env.REFRESH_TOKEN_EXPIRES_IN,
      issuer: 'MCR_PRO',
      audience: 'mcr_refresh'
    });
  }

  /**
   * Verifies Refresh Token
   */
  static verifyRefreshToken(token) {
    return jwt.verify(token, env.REFRESH_TOKEN_SECRET, {
      issuer: 'MCR_PRO',
      audience: 'mcr_refresh'
    });
  }

  /**
   * Generates a cryptographically random token (e.g. for pairing or session tokens)
   */
  static generateRandomToken(bytes = 32) {
    return crypto.randomBytes(bytes).toString('hex');
  }

  static signAgentToken(stationId, organizationId, generation) {
    return jwt.sign({ sub: stationId, organizationId, generation }, env.JWT_SECRET, {
      issuer: 'MCR_PRO', audience: 'mcr_agent', expiresIn: '90d'
    });
  }

  static verifyAgentToken(token) {
    return jwt.verify(token, env.JWT_SECRET, { issuer: 'MCR_PRO', audience: 'mcr_agent' });
  }

  /**
   * Hashes a single-use token or refresh token for persistent storage
   */
  static hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  /**
   * Generates an 8-character human-friendly pairing code (e.g., MCR-4K9P)
   */
  static generatePairingCode() {
    const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    let code = 'MCR-';
    const bytes = crypto.randomBytes(4);
    for (let i = 0; i < 4; i++) {
      code += chars[bytes[i] % chars.length];
    }
    return code;
  }
}
