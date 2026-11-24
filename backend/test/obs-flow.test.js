import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import WebSocket from 'ws';
import { io } from 'socket.io-client';
import sharp from 'sharp';

test('MCR pairs a station, scopes access, and waits for its OBS acknowledgement', { timeout: 15000 }, async (context) => {
  const directory = mkdtempSync(join(tmpdir(), 'mcr-obs-flow-'));
  process.env.NODE_ENV = 'test';
  process.env.SQLITE_DB_PATH = join(directory, 'test.db');
  const { server } = await import('../src/index.js');
  const { RepositoryFactory } = await import('../src/infrastructure/repositories/repository-factory.js');
  const { CryptoService } = await import('../src/infrastructure/security/crypto-service.js');
  const { createSession } = await import('../src/infrastructure/security/session-service.js');
  const { getSqliteDatabase } = await import('../src/infrastructure/database/sqlite.js');

  let agent;
  let dashboard;
  context.after(async () => {
    dashboard?.disconnect();
    agent?.terminate();
    server.closeAllConnections();
    if (server.listening) await new Promise((resolve) => server.close(resolve));
    getSqliteDatabase().close();
    rmSync(join(directory, 'test.db'), { force: true });
    rmdirSync(directory);
  });

  const admin = await RepositoryFactory.getUserRepository().create({
    email: 'integration@mcr.local', passwordHash: await CryptoService.hashPassword('Test-only-password'), fullName: 'Integration Operator',
    role: 'SUPER_ADMIN', organizationId: 'organization-1'
  });
  const station = await RepositoryFactory.getStationRepository().create({
    name: 'Integration station', organizationId: admin.organizationId,
    encryptedPassword: CryptoService.encryptSecret('OBS-integration-password')
  });
  const outsider = await RepositoryFactory.getUserRepository().create({
    email: 'outsider@mcr.local', passwordHash: 'unused', fullName: 'Other organization',
    role: 'SUPER_ADMIN', organizationId: 'another-organization'
  });
  const tokens = new Map([admin, outsider].map((user) => [
    user.organizationId, CryptoService.signAccessToken({ sub: user.id, sid: createSession(user.id).id })
  ]));

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = 'http://127.0.0.1:' + server.address().port;
  function request(path, { method = 'GET', organizationId, body } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (organizationId) headers.Authorization = 'Bearer ' + tokens.get(organizationId);
    return fetch(address + '/api/v1' + path, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body)
    });
  }

  const login = () => request('/auth/login', { method: 'POST', body: { email: admin.email, password: 'Test-only-password' } });
  const refresh = (refreshToken) => request('/auth/refresh', { method: 'POST', body: { refreshToken } });
  const cookie = (response, name) => response.headers.getSetCookie().find((value) => value.startsWith(name + '='))
    ?.split(';', 1)[0].slice(name.length + 1);
  const initial = await login();
  assert.equal(initial.status, 200);
  const initialRefresh = cookie(initial, 'mcr_refresh_token');
  const rotated = await refresh(initialRefresh);
  assert.equal(rotated.status, 200);
  const latestRefresh = cookie(rotated, 'mcr_refresh_token');
  assert.notEqual(latestRefresh, initialRefresh);
  assert.equal((await refresh(initialRefresh)).status, 401);
  assert.equal((await refresh(latestRefresh)).status, 401);

  const activeLogin = await login();
  assert.equal(activeLogin.status, 200);
  const accessToken = cookie(activeLogin, 'mcr_access_token');
  dashboard = io(address, { transports: ['websocket'], auth: { token: accessToken } });
  await once(dashboard, 'connect');
  const onDisconnect = once(dashboard, 'disconnect');
  const logout = await fetch(address + '/api/v1/auth/logout', { method: 'POST', headers: {
    Cookie: 'mcr_refresh_token=' + cookie(activeLogin, 'mcr_refresh_token')
  } });
  assert.equal(logout.status, 200);
  await onDisconnect;
  assert.equal((await refresh(cookie(activeLogin, 'mcr_refresh_token'))).status, 401);
  assert.equal((await fetch(address + '/api/v1/auth/me', { headers: { Authorization: 'Bearer ' + accessToken } })).status, 401);

  const generate = () => request('/pairing/generate', {
    method: 'POST', organizationId: admin.organizationId, body: { stationId: station.id }
  });
  const connectAgent = (token) => new WebSocket(address.replace('http:', 'ws:') + '/agent-ws', {
    headers: { 'x-station-id': station.id, 'x-agent-token': token }
  });
  const legacyToken = CryptoService.signAgentToken(station.id, admin.organizationId);
  agent = connectAgent(legacyToken);
  assert.equal(JSON.parse((await once(agent, 'message'))[0]).type, 'HANDSHAKE_ACK');
  const legacyClosed = once(agent, 'close');
  const generated = await generate();
  assert.equal(generated.status, 201);
  const { pairingCode } = await generated.json();
  const claim = (code = pairingCode) => request('/pairing/claim', {
    method: 'POST', body: { pairingCode: code, machineHostname: 'test', osPlatform: 'test', agentVersion: 'test' }
  });
  const claimed = await claim();
  assert.equal(claimed.status, 200);
  const { agentToken, obsConfig } = await claimed.json();
  assert.equal(obsConfig.password, 'OBS-integration-password');
  assert.equal((await claim()).status, 400);
  assert.equal((await legacyClosed)[0], 4003);
  assert.equal((await once(connectAgent(legacyToken), 'close'))[0], 4003);

  agent = connectAgent(agentToken);
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
  const png = 'data:image/png;base64,' + (await sharp({
    create: { width: 1, height: 1, channels: 3, background: '#fff' }
  }).png().toBuffer()).toString('base64');
  assert.equal((await request(graphicsPath + '/logo', {
    ...authorized, method: 'PUT', body: { content: '', image: 'data:image/png;base64,iVBORw0KGgo=' }
  })).status, 400);

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
  const rotatedGraphics = await request(graphicsPath + '/rotate-link', { ...authorized, method: 'POST' });
  assert.equal(rotatedGraphics.status, 200);
  assert.notEqual((await rotatedGraphics.json()).token, graphics.token);
  assert.equal((await request(publicGraphics)).status, 404);
  assert.equal((await request(stationPath, { method: 'DELETE', organizationId: 'another-organization' })).status, 404);
  const macro = await request('/automations', {
    ...authorized, method: 'POST',
    body: { name: 'Studio scene', stationId: station.id, action: 'scene', sceneName: 'Program B' }
  });
  assert.equal(macro.status, 201);
  await RepositoryFactory.getUserRepository().update(admin.id, { role: 'VIEWER' });
  assert.equal((await request(stationPath + '/scenes/switch', {
    ...authorized, method: 'POST', body: { sceneName: 'Program B' }
  })).status, 403);
  await RepositoryFactory.getUserRepository().update(admin.id, { isActive: false });
  assert.equal((await request(stationPath, authorized)).status, 401);
  await RepositoryFactory.getUserRepository().update(admin.id, { role: 'SUPER_ADMIN', isActive: true });
  assert.equal((await request(stationPath, authorized)).status, 401);
  tokens.set(admin.organizationId, CryptoService.signAccessToken({ sub: admin.id, sid: createSession(admin.id).id }));
  const { pairingCode: pendingCode } = await (await generate()).json();
  const revokePath = stationPath + '/agent/revoke';
  assert.equal((await request(revokePath, { method: 'POST', organizationId: 'another-organization' })).status, 404);
  const revokedConnection = once(agent, 'close');
  assert.equal((await request(revokePath, { ...authorized, method: 'POST' })).status, 200);
  assert.equal((await revokedConnection)[0], 4003);
  assert.equal((await once(connectAgent(agentToken), 'close'))[0], 4003);
  assert.equal((await claim(pendingCode)).status, 400);
  const { pairingCode: newCode } = await (await generate()).json();
  const renewed = await claim(newCode);
  assert.equal(renewed.status, 200);
  agent = connectAgent((await renewed.json()).agentToken);
  assert.equal(JSON.parse((await once(agent, 'message'))[0]).type, 'HANDSHAKE_ACK');
  const disconnected = once(agent, 'close');
  assert.equal((await request(stationPath, { ...authorized, method: 'DELETE' })).status, 200);
  assert.equal((await disconnected)[0], 4004);
  assert.equal((await request(stationPath, authorized)).status, 404);
  assert.equal((await request(publicGraphics)).status, 404);
  const db = getSqliteDatabase();
  for (const query of [
    'SELECT id FROM stations WHERE id = ?',
    'SELECT id FROM pairing_tokens WHERE stationId = ?',
    'SELECT id FROM station_automations WHERE stationId = ?',
    'SELECT stationId FROM station_agent_credentials WHERE stationId = ?'
  ]) {
    assert.equal(db.prepare(query).get(station.id), undefined);
  }
  assert.equal(db.prepare("SELECT action FROM audit_logs WHERE resourceId = ? AND action = 'STATION_DELETED'").get(station.id).action,
    'STATION_DELETED');
  assert.ok(db.prepare("SELECT id FROM audit_logs WHERE resourceId = ? AND action = 'AGENT_CREDENTIAL_REVOKED'").get(station.id));
});
