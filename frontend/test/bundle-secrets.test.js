import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const forbiddenPatterns = [
  { pattern: /DATABASE_URL\s*=/i, name: 'Database URL assignment' },
  { pattern: /mysql:\/\/[^\s"']+/i, name: 'MySQL connection string' },
  { pattern: /super_secret_jwt/i, name: 'JWT signing secret' },
  { pattern: /ENCRYPTION_MASTER_KEY/i, name: 'Master encryption key' },
  { pattern: /AGENT_REGISTRATION_SECRET/i, name: 'Agent registration secret' },
  { pattern: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/, name: 'Private key header' },
  { pattern: /@prisma\/client/i, name: 'Server ORM client import' }
];

function scanArtifacts(directory, canary) {
  const findings = [];
  let scripts = 0;
  for (const entry of fs.readdirSync(directory, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const filename = path.join(entry.parentPath, entry.name);
    const relative = path.relative(directory, filename);
    if (/\.m?js$/i.test(entry.name)) scripts++;
    const content = fs.readFileSync(filename, 'utf8');
    if (/\.map$/i.test(entry.name) || /(?:\/\/[#@]|\/\*[#@])\s*sourceMappingURL\s*=/.test(content)) {
      findings.push(`${relative}: published source map or reference`);
    }
    for (const { pattern, name } of forbiddenPatterns) {
      if (pattern.test(content)) findings.push(`${relative}: ${name}`);
    }
    if (canary && content.includes(canary)) findings.push(`${relative}: synthetic environment marker`);
  }
  return { scripts, findings };
}

test('frontend artifact audit detects a nested leak and reports only category and filename', context => {
  const directory = fs.mkdtempSync(path.join(tmpdir(), 'mcr-bundle-audit-'));
  const nested = path.join(directory, 'nested');
  const file = path.join(nested, 'public.txt');
  fs.mkdirSync(nested);
  context.after(() => {
    fs.rmSync(file, { force: true });
    fs.rmdirSync(nested);
    fs.rmdirSync(directory);
  });
  const canary = 'synthetic-test-marker';
  fs.writeFileSync(file, `${canary}\n//# sourceMappingURL=data:application/json;base64,fixture`);
  assert.deepEqual(scanArtifacts(directory, canary).findings, [
    `${path.relative(directory, file)}: published source map or reference`,
    `${path.relative(directory, file)}: synthetic environment marker`
  ]);
});

test('frontend production artifacts pass the secret and source map audit', () => {
  const directory = fileURLToPath(new URL('../dist/', import.meta.url));
  const { scripts, findings } = scanArtifacts(directory, process.env.MCR_BUNDLE_AUDIT_CANARY);
  assert.ok(scripts > 0, 'Build the frontend before running the artifact audit');
  assert.deepEqual(findings, []);
});
