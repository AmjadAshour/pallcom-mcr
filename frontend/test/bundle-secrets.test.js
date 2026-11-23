import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test('Security Audit: Frontend production bundle contains zero leaked secrets', () => {
  const distDir = path.resolve(__dirname, '../dist/assets');
  assert.ok(fs.existsSync(distDir), `Vite production dist must exist at ${distDir} before audit`);

  const files = fs.readdirSync(distDir).filter(f => f.endsWith('.js'));
  assert.ok(files.length > 0, 'At least one JS bundle must exist');

  // Forbidden patterns that must NEVER appear in frontend client bundles
  const forbiddenPatterns = [
    { pattern: /DATABASE_URL\s*=/i, name: 'Database URL assignment' },
    { pattern: /mysql:\/\/[^\s"']+/i, name: 'MySQL connection string' },
    { pattern: /super_secret_jwt/i, name: 'JWT signing secret' },
    { pattern: /ENCRYPTION_MASTER_KEY/i, name: 'Master encryption key' },
    { pattern: /AGENT_REGISTRATION_SECRET/i, name: 'Agent registration secret' },
    { pattern: /-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----/i, name: 'Private Key header' },
    { pattern: /@prisma\/client/i, name: 'Server ORM client import' }
  ];

  for (const file of files) {
    const content = fs.readFileSync(path.join(distDir, file), 'utf-8');
    for (const { pattern, name } of forbiddenPatterns) {
      const match = pattern.test(content);
      assert.equal(
        match,
        false,
        `CRITICAL SECURITY VIOLATION: ${name} (${pattern}) detected in bundle ${file}`
      );
    }
  }
});
