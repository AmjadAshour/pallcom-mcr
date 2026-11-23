import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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
  const loaded = Keystore.loadConfig();

  assert.ok(loaded);
  assert.equal(loaded.stationId, dummyConfig.stationId);
  assert.equal(loaded.agentToken, dummyConfig.agentToken);

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
