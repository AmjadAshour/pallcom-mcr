import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';

import { RepositoryFactory } from '../src/infrastructure/repositories/repository-factory.js';
import { CryptoService } from '../src/infrastructure/security/crypto-service.js';

test('Server RBAC: Access token signing and verification with roles', async () => {
  const userRepo = RepositoryFactory.getUserRepository();
  const testUser = await userRepo.create({
    email: `test_operator_${Date.now()}@mcrpro.local`,
    passwordHash: await CryptoService.hashPassword('Secret123!'),
    fullName: 'Test Operator',
    role: 'OPERATOR',
    organizationId: 'org-test-1'
  });

  assert.ok(testUser);
  assert.equal(testUser.role, 'OPERATOR');
  assert.equal(testUser.organizationId, 'org-test-1');

  // Verify token generation
  const token = CryptoService.signAccessToken({
    sub: testUser.id,
    email: testUser.email,
    organizationId: testUser.organizationId,
    role: testUser.role
  });

  const verified = CryptoService.verifyAccessToken(token);
  assert.equal(verified.sub, testUser.id);
  assert.equal(verified.role, 'OPERATOR');
  assert.equal(verified.organizationId, 'org-test-1');
});
