import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import WebSocket from 'ws';

test('MCR pairs a station, scopes access, and waits for its OBS acknowledgement', { timeout: 15000 }, async (context) => {
  const directory = mkdtempSync(join(tmpdir(), 'mcr-obs-flow-'));
  process.env.NODE_ENV = 'test';
  process.env.SQLITE_DB_PATH = join(directory, 'test.db');
  const { server } = await import('../src/index.js');
  const { RepositoryFactory } = await import('../src/infrastructure/repositories/repository-factory.js');
  const { CryptoService } = await import('../src/infrastructure/security/crypto-service.js');
  const { getSqliteDatabase } = await import('../src/infrastructure/database/sqlite.js');

  let agent;
  context.after(async () => {
    agent?.terminate();
    server.closeAllConnections();
    if (server.listening) await new Promise((resolve) => server.close(resolve));
    getSqliteDatabase().close();
    rmSync(join(directory, 'test.db'), { force: true });
    rmdirSync(directory);
  });

  const admin = await RepositoryFactory.getUserRepository().create({
    email: 'integration@mcr.local', passwordHash: 'unused', fullName: 'Integration Operator',
    role: 'SUPER_ADMIN', organizationId: 'organization-1'
  });
  const station = await RepositoryFactory.getStationRepository().create({
    name: 'Integration station', organizationId: admin.organizationId,
    encryptedPassword: CryptoService.encryptSecret('OBS-integration-password')
  });
  const tokenFor = (organizationId) => CryptoService.signAccessToken({
    sub: admin.id, email: admin.email, role: admin.role, organizationId
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = 'http://127.0.0.1:' + server.address().port;
  function request(path, { method = 'GET', organizationId, body } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (organizationId) headers.Authorization = 'Bearer ' + tokenFor(organizationId);
    return fetch(address + '/api/v1' + path, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body)
    });
  }

  const generated = await request('/pairing/generate', {
    method: 'POST', organizationId: admin.organizationId, body: { stationId: station.id }
  });
  assert.equal(generated.status, 201);
  const { pairingCode } = await generated.json();
  const claim = () => request('/pairing/claim', {
    method: 'POST', body: { pairingCode, machineHostname: 'test', osPlatform: 'test', agentVersion: 'test' }
  });
  const claimed = await claim();
  assert.equal(claimed.status, 200);
  const { agentToken, obsConfig } = await claimed.json();
  assert.equal(obsConfig.password, 'OBS-integration-password');
  assert.equal((await claim()).status, 400);

  agent = new WebSocket(address.replace('http:', 'ws:') + '/agent-ws', {
    headers: { 'x-station-id': station.id, 'x-agent-token': agentToken }
  });
  const [handshake] = await once(agent, 'message');
  assert.equal(JSON.parse(handshake).type, 'HANDSHAKE_ACK');
  let program = 'Initial scene';
  agent.on('message', (packet) => {
    const { correlationId, command, params } = JSON.parse(packet);
    if (command === 'SetCurrentProgramScene') program = params.sceneName;
    agent.send(JSON.stringify({ type: 'COMMAND_ACK', correlationId, result: { currentProgramScene: program } }));
  });

  const stationPath = '/stations/' + station.id;
  assert.equal((await request('/stations')).status, 401);
  assert.equal((await request(stationPath + '/stream/start', { method: 'POST' })).status, 401);
  assert.equal((await request(stationPath + '/snapshot', { organizationId: 'another-organization' })).status, 404);
  const switched = await request(stationPath + '/scenes/switch', {
    method: 'POST', organizationId: admin.organizationId, body: { sceneName: 'Program B' }
  });
  assert.equal(switched.status, 200);
  const snapshot = await request(stationPath + '/snapshot', { organizationId: admin.organizationId });
  assert.deepEqual((await snapshot.json()).data, { currentProgramScene: 'Program B' });

  const authorized = { organizationId: admin.organizationId };
  const graphicsPath = stationPath + '/graphics';
  const { data: graphics } = await (await request(graphicsPath, authorized)).json();
  assert.match(graphics.token, /^[a-f0-9]{64}$/);
  assert.equal((await request(graphicsPath, { organizationId: 'another-organization' })).status, 404);
  const publicGraphics = '/public/graphics/' + graphics.token;
  const readGraphics = async () => (await (await request(publicGraphics)).json()).data;
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/Z1sAAAAASUVORK5CYII=';

  for (const [kind, content, image] of [['ad', 'Sponsor', png], ['logo', '', png], ['ticker', 'خبر عاجل', '']]) {
    assert.equal((await request(graphicsPath + '/' + kind, {
      ...authorized, method: 'PUT', body: { content, image }
    })).status, 200);
  }
  assert.deepEqual(await readGraphics(), []);
  assert.equal((await request(graphicsPath + '/logo/publish', {
    ...authorized, method: 'POST', body: { duration: 0 }
  })).status, 200);
  const [logo] = await readGraphics();
  assert.equal(logo.kind, 'logo');
  assert.equal((await fetch(address + logo.image)).headers.get('content-type'), 'image/png');
  const publishTicker = await request(graphicsPath + '/ticker/publish', {
    ...authorized, method: 'POST', body: { duration: 1 }
  });
  assert.ok((await publishTicker.json()).expiresAt > Date.now());
  assert.ok((await readGraphics()).some((entry) => entry.kind === 'ticker'));
  await new Promise((resolve) => setTimeout(resolve, 1050));
  assert.deepEqual((await readGraphics()).map((entry) => entry.kind), ['logo']);
  assert.equal((await request(graphicsPath + '/logo', { ...authorized, method: 'DELETE' })).status, 200);
  assert.equal((await fetch(address + logo.image)).status, 404);
  assert.equal((await request(stationPath, { method: 'DELETE', organizationId: 'another-organization' })).status, 404);
  const macro = await request('/automations', {
    ...authorized, method: 'POST',
    body: { name: 'Studio scene', stationId: station.id, action: 'scene', sceneName: 'Program B' }
  });
  assert.equal(macro.status, 201);
  const disconnected = once(agent, 'close');
  assert.equal((await request(stationPath, { ...authorized, method: 'DELETE' })).status, 200);
  assert.equal((await disconnected)[0], 4004);
  assert.equal((await request(stationPath, authorized)).status, 404);
  assert.equal((await request(publicGraphics)).status, 404);
  const db = getSqliteDatabase();
  for (const query of [
    'SELECT id FROM stations WHERE id = ?',
    'SELECT id FROM pairing_tokens WHERE stationId = ?',
    'SELECT id FROM station_automations WHERE stationId = ?'
  ]) {
    assert.equal(db.prepare(query).get(station.id), undefined);
  }
  assert.equal(db.prepare("SELECT action FROM audit_logs WHERE resourceId = ? AND action = 'STATION_DELETED'").get(station.id).action,
    'STATION_DELETED');
});
