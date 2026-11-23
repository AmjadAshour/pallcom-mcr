import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';

import { CryptoService } from '../src/infrastructure/security/crypto-service.js';

test('CryptoService: Argon2id password hashing and verification', async () => {
  const plain = 'StrongBroadcastPass2026!';
  const hash = await CryptoService.hashPassword(plain);

  assert.ok(hash.startsWith('$argon2id$'), 'Hash must be in Argon2id format');
  assert.equal(await CryptoService.verifyPassword(hash, plain), true);
  assert.equal(await CryptoService.verifyPassword(hash, 'WrongPassword'), false);
});

test('CryptoService: AES-256-GCM Envelope Encryption round-trip', () => {
  const secretObsPassword = 'VerySecretObsStudioPassword4455';
  const encrypted = CryptoService.encryptSecret(secretObsPassword);

  assert.ok(encrypted.includes(':'), 'Encrypted payload must contain IV:tag:cipher delimiters');
  const decrypted = CryptoService.decryptSecret(encrypted);
  assert.equal(decrypted, secretObsPassword);
});

test('CryptoService: JWT Access Token signing and verification', () => {
  const payload = { sub: 'usr-123', email: 'operator@mcrpro.local', role: 'OPERATOR' };
  const token = CryptoService.signAccessToken(payload);

  assert.ok(token);
  const decoded = CryptoService.verifyAccessToken(token);
  assert.equal(decoded.sub, 'usr-123');
  assert.equal(decoded.email, 'operator@mcrpro.local');
  assert.equal(decoded.role, 'OPERATOR');
});

test('CryptoService: Pairing Code format', () => {
  const code = CryptoService.generatePairingCode();
  assert.match(code, /^MCR-[2-9A-Z]{4}$/);
});
