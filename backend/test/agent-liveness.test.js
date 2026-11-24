import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { AgentGateway } from '../src/infrastructure/agent/agent-gateway.js';

class AgentSocket extends EventEmitter {
  readyState = 1;
  bufferedAmount = 0;
  pingCount = 0;
  sent = [];

  ping() { this.pingCount++; }
  send(payload, callback) { this.sent.push(JSON.parse(payload)); callback(); }
  close(code) { this.closeCode = code; this.terminate(); }
  terminate() { this.readyState = 3; this.emit('close'); }
  receive(payload) { this.emit('message', Buffer.from(JSON.stringify(payload))); }
}

test('Agent gateway bounds and liveness', async () => {
  const gateway = new AgentGateway();
  const socket = new AgentSocket();
  const telemetry = [];
  const events = [];
  gateway.on('telemetry', ({ data }) => telemetry.push(data));
  gateway.on('obsEvent', (event) => events.push(event));
  gateway.registerAgent('station', socket);
  assert.equal(gateway.stationStatus('station'), 'DEGRADED');
  socket.receive({ type: 'TELEMETRY', data: { obsConnected: 'true' } });
  assert.equal(telemetry.length, 0);
  socket.receive({ type: 'TELEMETRY', data: { obsConnected: true, fps: 30, secret: 'private' } });
  assert.deepEqual(telemetry, [{ obsConnected: true, fps: 30 }]);
  assert.equal(gateway.stationStatus('station'), 'ONLINE');
  socket.receive({ type: 'OBS_EVENT', event: 'unregistered', data: {} });
  socket.receive({ type: 'OBS_EVENT', event: 'recordStateChanged', data: { active: true, state: 'active', outputPath: '/private' } });
  assert.deepEqual(events, [{ stationId: 'station', event: 'recordStateChanged', data: { active: true, state: 'active' } }]);

  const freshAt = gateway.connectedAgents.get('station').telemetryAt;
  gateway.sweepConnections(freshAt + 15_000);
  assert.equal(socket.pingCount, 1);
  assert.equal(gateway.stationStatus('station'), 'DEGRADED');
  assert.deepEqual(telemetry.at(-1), { obsConnected: false });
  socket.emit('pong');
  socket.receive({ type: 'TELEMETRY', data: { obsConnected: true } });
  assert.equal(gateway.stationStatus('station'), 'ONLINE');

  socket.bufferedAmount = 2 * 1024 * 1024;
  await assert.rejects(gateway.sendCommand('station', 'GetStats'), { statusCode: 503 });
  socket.bufferedAmount = 0;
  const outstanding = Array.from({ length: 32 }, () => gateway.sendCommand('station', 'GetStats'));
  const results = Promise.allSettled(outstanding);
  await assert.rejects(gateway.sendCommand('station', 'GetStats'), { statusCode: 503 });
  assert.equal(socket.sent.length, 32);
  gateway.sweepConnections();
  gateway.sweepConnections();
  assert.equal(gateway.stationStatus('station'), 'OFFLINE');
  assert.ok((await results).every(({ status, reason }) => status === 'rejected' && reason.statusCode === 503));

  const expired = new AgentSocket();
  gateway.registerAgent('expired', expired, { expiresAt: freshAt });
  gateway.sweepConnections(freshAt);
  assert.equal(expired.closeCode, 4003);
  assert.equal(gateway.stationStatus('expired'), 'OFFLINE');
});
