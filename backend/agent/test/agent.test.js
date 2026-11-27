import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { TelemetryCollector } from '../src/telemetry.js';

test('Agent Keystore: Save, load, and clear configuration', async (context) => {
  const temporaryConfig = fs.mkdtempSync(path.join(os.tmpdir(), 'mcr-agent-test-'));
  context.after(() => {
    fs.rmSync(path.join(temporaryConfig, 'credentials.json'), { force: true });
    fs.rmdirSync(temporaryConfig);
  });
  const previousConfig = process.env.MCR_AGENT_CONFIG_DIR;
  process.env.MCR_AGENT_CONFIG_DIR = temporaryConfig;
  const { Keystore } = await import('../src/keystore.js');
  if (previousConfig === undefined) delete process.env.MCR_AGENT_CONFIG_DIR;
  else process.env.MCR_AGENT_CONFIG_DIR = previousConfig;
  const dummyConfig = {
    stationId: 'st-unit-test-1',
    agentToken: 'token-abc-123',
    serverUrl: 'http://localhost:4000',
    obsPort: 4455
  };

  Keystore.saveConfig(dummyConfig);
  const saved = fs.readFileSync(path.join(temporaryConfig, 'credentials.json'), 'utf8');
  if (process.platform === 'win32') {
    assert.equal(typeof JSON.parse(saved).dpapi, 'string');
    assert.equal(saved.includes(dummyConfig.agentToken), false);
    const powershell = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const checkAcl = [
      "$ErrorActionPreference = 'Stop'",
      '$directory = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::In.ReadToEnd()))',
      '$acl = [IO.Directory]::GetAccessControl($directory)',
      '$owner = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value',
      '$rules = $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])',
      "[Console]::Write(('{0},{1},{2}' -f $acl.AreAccessRulesProtected, $rules.Count, @($rules | Where-Object { $_.IdentityReference.Value -notin @($owner, 'S-1-5-18') -or $_.AccessControlType -ne 'Allow' }).Count))",
    ].join('; ');
    const aclResult = execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', checkAcl], {
      input: Buffer.from(temporaryConfig).toString('base64'), windowsHide: true,
      encoding: 'utf8',
    }).trim();
    assert.equal(aclResult, 'True,2,0', 'Expect protected inheritance, two trusted entries, and zero other entries');
    fs.writeFileSync(path.join(temporaryConfig, 'credentials.json'), JSON.stringify(dummyConfig));
    assert.deepEqual(Keystore.loadConfig(), dummyConfig);
    assert.equal(fs.readFileSync(path.join(temporaryConfig, 'credentials.json'), 'utf8')
      .includes(dummyConfig.agentToken), false);
  } else {
    fs.chmodSync(temporaryConfig, 0o755);
    fs.chmodSync(path.join(temporaryConfig, 'credentials.json'), 0o644);
  }
  const loaded = Keystore.loadConfig();

  assert.ok(loaded);
  assert.equal(loaded.stationId, dummyConfig.stationId);
  assert.equal(loaded.agentToken, dummyConfig.agentToken);
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(temporaryConfig).mode & 0o777, 0o700);
    assert.equal(fs.statSync(path.join(temporaryConfig, 'credentials.json')).mode & 0o777, 0o600);
  }

  Keystore.clear();
  assert.equal(Keystore.loadConfig(), null);
});

test('Agent TelemetryCollector: System metrics structure', () => {
  const metrics = TelemetryCollector.getSystemMetrics();

  assert.ok(metrics.hostname);
  assert.ok(metrics.platform);
  assert.equal(typeof metrics.cpuUsage, 'number');
  assert.equal(typeof metrics.memoryUsage, 'number');
  assert.ok(metrics.uptimeSeconds > 0);
});
