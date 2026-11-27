import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, rmSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import WebSocket from 'ws';
import { io } from 'socket.io-client';
import sharp from 'sharp';

test('MCR pairs a station, scopes access, and waits for its OBS acknowledgement', { timeout: 15000 }, async (context) => {
  const directory = mkdtempSync(join(tmpdir(), 'mcr-obs-flow-'));
  process.env.NODE_ENV = 'test';
  process.env.SQLITE_DB_PATH = join(directory, 'test.db');
  const oldDb = new DatabaseSync(process.env.SQLITE_DB_PATH);
  oldDb.exec('CREATE TABLE station_graphics_tokens (stationId TEXT PRIMARY KEY, token TEXT NOT NULL UNIQUE)');
  oldDb.prepare('INSERT INTO station_graphics_tokens VALUES (?, ?)').run('legacy-station', 'legacy-overlay-fixture');
  oldDb.close();
  const browserOrigin = 'http://localhost:5173';
  process.env.CORS_ORIGIN = browserOrigin;
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
  const legacyGraphics = getSqliteDatabase().prepare('SELECT token, expiresAt FROM station_graphics_tokens WHERE stationId = ?')
    .get('legacy-station');
  assert.equal(legacyGraphics.token, 'legacy-overlay-fixture');
  assert.equal(legacyGraphics.expiresAt, null);

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
  const dashboardClient = token => io(address, {
    transports: ['websocket'], auth: { token }, autoConnect: false, reconnection: false
  });
  const loginUrl = address + '/api/v1/auth/login';
  const preflight = (url, origin) => fetch(url, {
    method: 'OPTIONS', headers: {
      Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'Content-Type'
    }
  });
  for (const url of [loginUrl, address + '/socket.io/?EIO=4&transport=polling']) {
    const allowed = await preflight(url, browserOrigin);
    assert.equal(allowed.status, 204);
    assert.equal(allowed.headers.get('Access-Control-Allow-Origin'), browserOrigin);
    assert.equal(allowed.headers.get('Access-Control-Allow-Credentials'), 'true');
    assert.match(allowed.headers.get('Vary'), /\bOrigin\b/i);
    for (const origin of ['https://untrusted.example', 'null']) {
      const denied = await preflight(url, origin);
      assert.equal(denied.headers.get('Access-Control-Allow-Origin'), null);
      assert.match(denied.headers.get('Vary'), /\bOrigin\b/i);
    }
  }
  const allowedHealth = await fetch(address + '/health', { headers: { Origin: browserOrigin } });
  assert.equal(allowedHealth.status, 200);
  assert.equal(allowedHealth.headers.get('Access-Control-Allow-Origin'), browserOrigin);
  assert.equal(allowedHealth.headers.get('X-Content-Type-Options'), 'nosniff');
  await allowedHealth.text();
  const deniedHealth = await fetch(address + '/health', { headers: { Origin: 'https://untrusted.example' } });
  assert.equal(deniedHealth.headers.get('Access-Control-Allow-Origin'), null);
  await deniedHealth.text();
  const rejectedOrigin = await fetch(loginUrl, {
    method: 'POST', headers: { 'Sec-Fetch-Site': 'cross-site', 'Content-Type': 'application/json' }, body: '{}'
  });
  assert.equal(rejectedOrigin.status, 403);
  const malformed = await fetch(loginUrl, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"syntheticMarker":'
  });
  assert.equal(malformed.status, 400);
  assert.deepEqual(await malformed.json(), { success: false, error: 'Invalid request body' });
  const oversized = await fetch(loginUrl, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ padding: 'a'.repeat(101 * 1024) })
  });
  assert.equal(oversized.status, 413);
  assert.deepEqual(await oversized.json(), { success: false, error: 'Request body is too large' });
  const unsupported = await fetch(loginUrl, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'synthetic-encoding' },
    body: '{}'
  });
  assert.equal(unsupported.status, 415);
  assert.deepEqual(await unsupported.json(), { success: false, error: 'Unsupported request body format' });

  function request(path, { method = 'GET', organizationId, body } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (organizationId) headers.Authorization = 'Bearer ' + tokens.get(organizationId);
    return fetch(address + '/api/v1' + path, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body)
    });
  }

  const stationResource = '/stations/' + station.id;
  const roleExpectations = [
    ['SUPER_ADMIN', 200, 400, 400, 200, 200],
    ['ORG_ADMIN', 200, 400, 400, 200, 200],
    ['STUDIO_MANAGER', 200, 400, 400, 403, 200],
    ['OPERATOR', 200, 403, 400, 403, 200],
    ['VIEWER', 200, 403, 403, 403, 403],
    ['constructor', 403, 403, 403, 403, 403]
  ];
  // Invalid write bodies distinguish permission acceptance from denial without changing station state.
  const permissionRequests = [
    ['GET', stationResource],
    ['POST', '/stations'],
    ['POST', stationResource + '/scenes/switch'],
    ['GET', '/users'],
    ['GET', '/logs']
  ];
  for (const [role, ...expectedStatuses] of roleExpectations) {
    const actor = role === admin.role ? admin : await RepositoryFactory.getUserRepository().create({
      email: role.toLowerCase() + '@roles.mcr.local', fullName: 'Fixture ' + role,
      passwordHash: 'unused', role, organizationId: admin.organizationId
    });
    const token = CryptoService.signAccessToken({ sub: actor.id, sid: createSession(actor.id).id });
    if (role === 'constructor' || role === 'VIEWER') {
      const socket = dashboardClient(token);
      try {
        if (role === 'constructor') {
          const rejected = once(socket, 'connect_error');
          socket.connect();
          assert.equal((await rejected)[0].message, 'Authentication failed for WebSocket');
        } else {
          const connected = once(socket, 'connect');
          socket.connect();
          await connected;
          const result = await socket.timeout(2000).emitWithAck('playout:subscribe', station.id);
          assert.equal(result.data.stationId, station.id);
        }
      } finally {
        socket.disconnect();
      }
    }
    for (const [index, [method, path]] of permissionRequests.entries()) {
      const response = await fetch(address + '/api/v1' + path, {
        method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: method === 'POST' ? '{}' : undefined
      });
      assert.equal(response.status, expectedStatuses[index], role + ' ' + method + ' ' + path);
      await response.text();
    }
  }
  const foreignRead = await request(stationResource, { organizationId: outsider.organizationId });
  assert.equal(foreignRead.status, 404);
  await foreignRead.text();
  const foreignSocket = dashboardClient(tokens.get(outsider.organizationId));
  try {
    const connected = once(foreignSocket, 'connect');
    foreignSocket.connect();
    await connected;
    assert.deepEqual(await foreignSocket.timeout(2000).emitWithAck('playout:subscribe', station.id), {
      error: 'Station not found'
    });
  } finally {
    foreignSocket.disconnect();
  }

  const stationFilters = '/stations?status=OFFLINE&streamStatus=STOPPED';
  const matchingStations = await request(stationFilters, { organizationId: admin.organizationId });
  assert.equal(matchingStations.status, 200);
  assert.deepEqual((await matchingStations.json()).data.map(({ id }) => id), [station.id]);
  const otherStations = await request(stationFilters, { organizationId: outsider.organizationId });
  assert.equal(otherStations.status, 200);
  assert.deepEqual((await otherStations.json()).data, []);
  const nonmatchingStations = await request('/stations?streamStatus=STREAMING', { organizationId: admin.organizationId });
  assert.equal(nonmatchingStations.status, 200);
  assert.deepEqual((await nonmatchingStations.json()).data, []);
  for (const query of ['status=unknown', 'streamStatus=', 'status=OFFLINE&status=ONLINE']) {
    const invalidFilter = await request('/stations?' + query, { organizationId: admin.organizationId });
    assert.equal(invalidFilter.status, 400);
    assert.deepEqual(await invalidFilter.json(), { success: false, error: 'Invalid station status filter' });
  }

  const ownStudio = randomUUID();
  const foreignStudio = randomUUID();
  const insertStudio = getSqliteDatabase().prepare(`
    INSERT INTO studios (id, organizationId, name, createdAt, updatedAt)
    VALUES (?, ?, 'Fixture studio', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `);
  insertStudio.run(ownStudio, admin.organizationId);
  insertStudio.run(foreignStudio, outsider.organizationId);
  const stationWrite = (method, path, body) => request(path, { method, body, organizationId: admin.organizationId });
  const added = await stationWrite('POST', '/stations', { name: 'Fixture assigned station', studioId: ownStudio });
  assert.equal(added.status, 201);
  const assignedPath = '/stations/' + (await added.json()).data.id;
  const stationDb = getSqliteDatabase();
  const stationCount = stationDb.prepare('SELECT count(*) AS count FROM stations');
  const stationAuditCount = stationDb.prepare(
    "SELECT count(*) AS count FROM audit_logs WHERE action IN ('STATION_CREATED', 'STATION_UPDATED')"
  );
  const previousStationCount = stationCount.get().count;
  const previousAuditCount = stationAuditCount.get().count;
  const invalidCreate = await stationWrite('POST', '/stations', {
    name: 'Fixture rejected fields', organizationId: outsider.organizationId
  });
  assert.equal(invalidCreate.status, 400);
  await invalidCreate.text();
  const invalidUpdate = await stationWrite('PATCH', assignedPath, { obsPort: 4456, streamStatus: 'STREAMING' });
  assert.equal(invalidUpdate.status, 400);
  await invalidUpdate.text();
  assert.equal(stationCount.get().count, previousStationCount);
  assert.equal(stationAuditCount.get().count, previousAuditCount);
  const unchangedStation = await request(assignedPath, { organizationId: admin.organizationId });
  const { data: priorStation } = await unchangedStation.json();
  assert.equal(priorStation.obsPort, 4455);
  assert.equal(priorStation.streamStatus, 'STOPPED');
  const settingsUpdate = await stationWrite('PATCH', assignedPath, { obsPort: 4456 });
  assert.equal(settingsUpdate.status, 200);
  await settingsUpdate.text();
  const updatedStation = await request(assignedPath, { organizationId: admin.organizationId });
  assert.equal((await updatedStation.json()).data.obsPort, 4456);
  for (const studioId of [foreignStudio, randomUUID()]) {
    const createDenied = await stationWrite('POST', '/stations', { name: 'Fixture rejected station', studioId });
    const updateDenied = await stationWrite('PATCH', assignedPath, { studioId });
    for (const denied of [createDenied, updateDenied]) {
      assert.equal(denied.status, 404);
      assert.deepEqual(await denied.json(), { success: false, error: 'Studio not found' });
    }
  }
  const assigned = await request(assignedPath, { organizationId: admin.organizationId });
  assert.equal((await assigned.json()).data.studioId, ownStudio);
  assert.equal((await stationWrite('PATCH', assignedPath, { studioId: null })).status, 200);
  const unassigned = await request(assignedPath, { organizationId: admin.organizationId });
  assert.equal((await unassigned.json()).data.studioId, null);
  assert.equal((await stationWrite('PATCH', assignedPath, { studioId: ownStudio })).status, 200);

  const login = () => request('/auth/login', { method: 'POST', body: { email: admin.email, password: 'Test-only-password' } });
  const refresh = (refreshToken) => request('/auth/refresh', { method: 'POST', body: { refreshToken } });
  const cookie = (response, name) => response.headers.getSetCookie().find((value) => value.startsWith(name + '='))
    ?.split(';', 1)[0].slice(name.length + 1);
  const sessionCount = getSqliteDatabase().prepare('SELECT count(*) AS count FROM auth_sessions');
  const sessionsBeforeLogin = sessionCount.get().count;
  for (const body of [
    { email: admin.email, password: 'x'.repeat(4097) },
    { email: admin.email, password: 'Test-only-password', role: 'SUPER_ADMIN' }
  ]) {
    const response = await request('/auth/login', { method: 'POST', body });
    assert.equal(response.status, 400);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(response.headers.getSetCookie(), []);
    await response.text();
  }
  assert.equal(sessionCount.get().count, sessionsBeforeLogin);
  const initial = await login();
  assert.equal(initial.status, 200);
  const initialRefresh = cookie(initial, 'mcr_refresh_token');
  for (const body of [
    { refreshToken: { value: initialRefresh } },
    { refreshToken: 'a'.repeat(4097) },
    { refreshToken: initialRefresh, unexpected: true }
  ]) {
    const rejected = await request('/auth/refresh', { method: 'POST', body });
    assert.equal(rejected.status, 401);
    assert.equal(rejected.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(rejected.headers.getSetCookie(), []);
    assert.deepEqual(await rejected.json(), { success: false, error: 'Invalid or expired refresh token' });
  }
  const rotated = await refresh(initialRefresh);
  assert.equal(rotated.status, 200);
  const latestRefresh = cookie(rotated, 'mcr_refresh_token');
  assert.notEqual(latestRefresh, initialRefresh);
  assert.equal((await refresh(initialRefresh)).status, 401);
  assert.equal((await refresh(latestRefresh)).status, 401);

  assert.equal(initial.headers.get('Cache-Control'), 'no-store');
  assert.equal(typeof (await initial.json()).accessToken, 'string');
  assert.equal(typeof (await rotated.json()).accessToken, 'string');
  assert.equal((await fetch(address + '/api/v1/auth/me')).headers.get('Cache-Control'), 'no-store');

  const browserLogin = await fetch(loginUrl, {
    method: 'POST',
    headers: { Origin: address, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: admin.email, password: 'Test-only-password' })
  });
  assert.equal(browserLogin.status, 200);
  assert.equal(browserLogin.headers.get('Cache-Control'), 'no-store');
  assert.equal((await browserLogin.json()).accessToken, undefined);
  assert(browserLogin.headers.getSetCookie().every(value => /HttpOnly/i.test(value)));
  const browserRefresh = await fetch(address + '/api/v1/auth/refresh', {
    method: 'POST',
    headers: { Origin: address, Cookie: 'mcr_refresh_token=' + cookie(browserLogin, 'mcr_refresh_token') }
  });
  assert.equal(browserRefresh.status, 200);
  assert.deepEqual(await browserRefresh.json(), { success: true });
  const browserAccess = cookie(browserRefresh, 'mcr_access_token');
  const browserMe = await fetch(address + '/api/v1/auth/me', {
    headers: { Cookie: 'mcr_access_token=' + browserAccess }
  });
  assert.equal(browserMe.status, 200);
  assert.equal(browserMe.headers.get('Cache-Control'), 'no-store');

  const activeLogin = await login();
  assert.equal(activeLogin.status, 200);
  const accessToken = cookie(activeLogin, 'mcr_access_token');
  dashboard = io(address, { transports: ['websocket'], auth: { token: accessToken } });
  await once(dashboard, 'connect');
  const onDisconnect = once(dashboard, 'disconnect');
  const deniedLogout = await fetch(address + '/api/v1/auth/logout', { method: 'POST', headers: {
    Cookie: 'mcr_refresh_token=' + cookie(activeLogin, 'mcr_refresh_token')
  } });
  assert.equal(deniedLogout.status, 403);
  const logout = await fetch(address + '/api/v1/auth/logout', { method: 'POST', headers: {
    Origin: address,
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
  const replayPath = stationPath + '/replay/save';
  assert.equal((await request(replayPath, { method: 'POST', organizationId: 'another-organization' })).status, 404);
  const replayCommand = once(agent, 'message');
  assert.equal((await request(replayPath, { ...authorized, method: 'POST' })).status, 200);
  assert.equal(JSON.parse((await replayCommand)[0]).command, 'SaveReplayBuffer');
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
  const rotatedLink = await rotatedGraphics.json();
  assert.notEqual(rotatedLink.token, graphics.token);
  assert.ok(rotatedLink.expiresAt > Date.now());
  assert.equal((await request(publicGraphics)).status, 404);
  const rotatedPath = '/public/graphics/' + rotatedLink.token;
  const refreshedGraphics = await request(rotatedPath);
  assert.equal(refreshedGraphics.status, 200);
  assert.equal(refreshedGraphics.headers.get('referrer-policy'), 'no-referrer');
  getSqliteDatabase().prepare('UPDATE station_graphics_tokens SET expiresAt = ? WHERE stationId = ?')
    .run(Date.now() - 1, station.id);
  assert.equal((await request(rotatedPath)).status, 404);
  const newestLink = await (await request(graphicsPath + '/rotate-link', { ...authorized, method: 'POST' })).json();
  assert.equal((await request(graphicsPath + '/link', { organizationId: 'another-organization', method: 'DELETE' })).status, 404);
  assert.equal((await request(graphicsPath + '/link', { ...authorized, method: 'DELETE' })).status, 204);
  assert.equal((await request('/public/graphics/' + newestLink.token)).status, 404);
  assert.equal((await (await request(graphicsPath, authorized)).json()).data.token, null);
  assert.equal((await request(stationPath, { method: 'DELETE', organizationId: 'another-organization' })).status, 404);
  const macro = await request('/automations', {
    ...authorized, method: 'POST',
    body: { name: 'Studio scene', stationId: station.id, action: 'scene', sceneName: 'Program B' }
  });
  assert.equal(macro.status, 201);
  const scheduler = await RepositoryFactory.getUserRepository().create({
    email: 'scheduler-scope@mcr.local', passwordHash: 'unused', fullName: 'Fixture Scheduler',
    role: 'STUDIO_MANAGER', organizationId: admin.organizationId
  });
  const schedulerToken = CryptoService.signAccessToken({ sub: scheduler.id, sid: createSession(scheduler.id).id });
  const scheduleDb = getSqliteDatabase();
  const dueAt = new Date(Date.now() + 60_000).toISOString();
  const scheduled = await fetch(address + '/api/v1/automations', {
    method: 'POST', headers: { Authorization: 'Bearer ' + schedulerToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Fixture scheduled job', stationId: station.id, action: 'scene',
      sceneName: 'Denied scheduled scene', runAt: dueAt })
  });
  assert.equal(scheduled.status, 201);
  const { id: deniedJob } = await scheduled.json();
  await RepositoryFactory.getUserRepository().update(scheduler.id, { organizationId: outsider.organizationId });
  const allowedSchedule = await request('/automations', {
    ...authorized, method: 'POST', body: {
      name: 'Fixture allowed job', stationId: station.id, action: 'scene', sceneName: 'Allowed scheduled scene', runAt: dueAt
    }
  });
  assert.equal(allowedSchedule.status, 201);
  const { id: allowedJob } = await allowedSchedule.json();
  scheduleDb.prepare('UPDATE station_automations SET runAt = ? WHERE id IN (?, ?)')
    .run(new Date(Date.now() - 1000).toISOString(), deniedJob, allowedJob);
  const commands = [];
  const captureCommand = packet => {
    const { params } = JSON.parse(packet);
    if (params?.sceneName) commands.push(params.sceneName);
  };
  agent.on('message', captureCommand);
  const { startAutomationWorker } = await import('../src/presentation/controllers/automation.controller.js');
  const stopWorker = startAutomationWorker();
  try {
    const readJob = scheduleDb.prepare('SELECT status FROM station_automations WHERE id = ?');
    const deadline = Date.now() + 4000;
    while (readJob.get(allowedJob).status !== 'SUCCEEDED' && Date.now() < deadline) await delay(25);
    assert.equal(readJob.get(allowedJob).status, 'SUCCEEDED');
    assert.equal(readJob.get(deniedJob).status, 'FAILED');
    assert.deepEqual(commands, ['Allowed scheduled scene']);
    const failure = scheduleDb.prepare("SELECT details FROM audit_logs WHERE action = 'AUTOMATION_FAILED' AND resourceId = ?")
      .get(station.id);
    assert.equal(JSON.parse(failure.details).automationId, deniedJob);
  } finally {
    stopWorker();
    agent.off('message', captureCommand);
  }
  const { id: macroId } = await macro.json();
  const macroRunPath = '/automations/' + macroId + '/run';
  const foreignRun = await request(macroRunPath, { organizationId: outsider.organizationId, method: 'POST' });
  assert.equal(foreignRun.status, 404);
  await foreignRun.text();
  const operator = await RepositoryFactory.getUserRepository().findByEmail('operator@roles.mcr.local');
  const macroOperatorToken = CryptoService.signAccessToken({ sub: operator.id, sid: createSession(operator.id).id });
  const manualRun = await fetch(address + '/api/v1' + macroRunPath, {
    method: 'POST', headers: { Authorization: 'Bearer ' + macroOperatorToken }
  });
  assert.equal(manualRun.status, 200);
  const { data: manualJob } = await manualRun.json();
  assert.equal(manualJob.status, 'SUCCEEDED');
  assert.equal(manualJob.userId, admin.id);
  const runAudits = scheduleDb.prepare(`SELECT userId, organizationId FROM audit_logs
    WHERE action = 'AUTOMATION_EXECUTED' AND json_extract(details, '$.automationId') = ?`);
  assert.deepEqual(runAudits.all(macroId).map(event => ({ ...event })), [
    { userId: operator.id, organizationId: admin.organizationId }
  ]);
  assert.equal(runAudits.get(allowedJob).userId, admin.id);
  const creationEvent = scheduleDb.prepare(`SELECT userId, organizationId, resourceId, details FROM audit_logs
    WHERE action = 'AUTOMATION_CREATED' AND json_extract(details, '$.automationId') = ?`);
  for (const [jobId, mode] of [[macroId, 'manual'], [allowedJob, 'scheduled']]) {
    const event = creationEvent.get(jobId);
    assert.equal(event.userId, admin.id);
    assert.equal(event.organizationId, admin.organizationId);
    assert.equal(event.resourceId, station.id);
    assert.deepEqual(JSON.parse(event.details), { automationId: jobId, mode });
  }
  scheduleDb.exec(`CREATE TEMP TRIGGER reject_automation_creation_audit BEFORE INSERT ON audit_logs
    WHEN NEW.action = 'AUTOMATION_CREATED' BEGIN SELECT RAISE(ABORT, 'fixture audit write failed'); END`);
  try {
    const failedCreation = await request('/automations', {
      ...authorized, method: 'POST',
      body: { name: 'Fixture rejected creation', stationId: station.id, action: 'recordingStop', runAt: dueAt }
    });
    assert.equal(failedCreation.status, 500);
    await failedCreation.text();
    assert.equal(scheduleDb.prepare('SELECT id FROM station_automations WHERE name = ?').get('Fixture rejected creation'), undefined);
  } finally {
    scheduleDb.exec('DROP TRIGGER reject_automation_creation_audit');
  }
  const pending = await request('/automations', {
    ...authorized, method: 'POST',
    body: { name: 'Fixture cancellation', stationId: station.id, action: 'recordingStop', runAt: dueAt }
  });
  assert.equal(pending.status, 201);
  const { id: pendingId } = await pending.json();
  const cancelPath = '/automations/' + pendingId + '/cancel';
  const cancel = () => request(cancelPath, { ...authorized, method: 'POST' });
  const pendingStatus = scheduleDb.prepare('SELECT status FROM station_automations WHERE id = ?');
  const foreignCancel = await request(cancelPath, { method: 'POST', organizationId: outsider.organizationId });
  assert.equal(foreignCancel.status, 409);
  await foreignCancel.text();
  scheduleDb.exec(`CREATE TEMP TRIGGER reject_automation_audit BEFORE INSERT ON audit_logs
    WHEN NEW.action = 'AUTOMATION_CANCELLED' BEGIN SELECT RAISE(ABORT, 'fixture audit write failed'); END`);
  try {
    const failedCancel = await cancel();
    assert.equal(failedCancel.status, 500);
    await failedCancel.text();
    assert.equal(pendingStatus.get(pendingId).status, 'SCHEDULED');
  } finally {
    scheduleDb.exec('DROP TRIGGER reject_automation_audit');
  }
  const attempts = await Promise.all([cancel(), cancel()]);
  assert.deepEqual(attempts.map(response => response.status).sort(), [200, 409]);
  await Promise.all(attempts.map(response => response.text()));
  assert.equal(pendingStatus.get(pendingId).status, 'CANCELLED');
  const cancellations = scheduleDb.prepare(`SELECT userId, organizationId, resourceId, details FROM audit_logs
    WHERE action = 'AUTOMATION_CANCELLED'`).all();
  assert.deepEqual(cancellations.map(event => ({ ...event, details: JSON.parse(event.details) })), [
    { userId: admin.id, organizationId: admin.organizationId, resourceId: station.id, details: { automationId: pendingId } }
  ]);
  const audioAction = {
    method: 'POST', body: { action: 'input-audio', inputAudio: { input: 'obs2', mode: 'on', gainDb: -12 } }
  };
  assert.equal((await request(stationPath + '/program', { ...audioAction, organizationId: 'another-organization' })).status, 404);
  assert.equal((await request(stationPath + '/program', {
    ...authorized, ...audioAction, body: { action: 'input-audio', inputAudio: { input: 'obs2', mode: 'on', gainDb: 1 } }
  })).status, 400);
  const selectionPath = stationPath + '/program/selection';
  assert.equal((await request(selectionPath, { method: 'PUT', organizationId: 'another-organization' })).status, 404);
  assert.equal((await request(selectionPath, { ...authorized, method: 'PUT' })).status, 200);
  const persisted = getSqliteDatabase().prepare('SELECT stationId FROM program_station_selection WHERE singleton=1').get();
  assert.equal(persisted.stationId, station.id);
  assert.equal((await (await request(stationPath + '/program', authorized)).json()).data.configured, true);
  const viewerAccount = await RepositoryFactory.getUserRepository().findByEmail('viewer@roles.mcr.local');
  const viewerToken = CryptoService.signAccessToken({ sub: viewerAccount.id, sid: createSession(viewerAccount.id).id });
  for (const [suffix, viewerStatus] of [
    ['/playout', 200], ['/playout/as-run', 200], ['/graphics', 403],
    ['/program/input-preview', 200], ['/program/program-monitor', 200],
    ['/program/ads', 403], ['/program/local-scene/library', 403],
    ['/program/ticker', 403], ['/program/watermark', 403]
  ]) {
    const route = stationPath + suffix;
    const unauthenticated = await request(route);
    assert.equal(unauthenticated.status, 401, route);
    await unauthenticated.text();
    const foreign = await request(route, { organizationId: outsider.organizationId });
    assert.equal(foreign.status, 404, route);
    await foreign.text();
    const viewerRead = await fetch(address + '/api/v1' + route, { headers: { Authorization: 'Bearer ' + viewerToken } });
    assert.equal(viewerRead.status, viewerStatus, route);
    await viewerRead.text();
    const stationRead = await request(route, authorized);
    assert.equal(stationRead.status, 200, route);
    await stationRead.text();
  }
  getSqliteDatabase().prepare(`INSERT INTO program_schedule
    (id, stationId, userId, sceneId, scene, dueAt, state) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(randomUUID(), station.id, admin.id, randomUUID(), JSON.stringify({ name: '＋أخبار, "الآن"' }), Date.now(), 'skipped');
  const scheduleExport = stationPath + '/program/local-scene/schedule.csv';
  const exported = await request(scheduleExport, authorized);
  assert.equal(exported.status, 200);
  assert.match(exported.headers.get('Content-Disposition'), /attachment;.*program-schedule\.csv/);
  assert((await exported.text()).includes('"\'＋أخبار, ""الآن"""'));
  assert.equal((await request(scheduleExport, { organizationId: outsider.organizationId })).status, 404);
  const { reserveCreativeUpload } = await import('../src/infrastructure/program/creative-library.js');
  const unsupportedAd = () => fetch(address + '/api/v1' + stationPath + '/program/ads/assets?name=fixture', {
    method: 'POST', headers: {
      Authorization: 'Bearer ' + tokens.get(admin.organizationId),
      'Content-Type': 'image/png', 'Content-Encoding': 'synthetic-encoding'
    }, body: 'fixture'
  });
  const releaseUpload = reserveCreativeUpload();
  try {
    const busy = await unsupportedAd();
    assert.equal(busy.status, 409);
    await busy.text();
  } finally {
    releaseUpload();
  }
  const unsupportedAdResponse = await unsupportedAd();
  assert.equal(unsupportedAdResponse.status, 415);
  await unsupportedAdResponse.text();
  reserveCreativeUpload()();
  const mediaUpload = suffix => request(stationPath + '/program' + suffix, {
    ...authorized, method: 'POST', body: {}
  });
  for (let index = 0; index < 10; index++) {
    const route = index % 2 ? '/ads/assets?name=invalid' : '/local-scene/video?name=invalid';
    const rejected = await mediaUpload(route);
    assert.equal(rejected.status, 400);
    await rejected.text();
  }
  const limited = await mediaUpload('/ads/assets?name=invalid');
  assert.equal(limited.status, 429);
  assert(Number(limited.headers.get('Retry-After')) > 0);
  assert.equal((await request(stationPath + '/program', authorized)).status, 200);
  const { hasCurrentPermission } = await import('../src/presentation/middlewares/auth.middleware.js');
  const claims = CryptoService.verifyAccessToken(tokens.get(admin.organizationId));
  const uploadActor = { id: admin.id, organizationId: admin.organizationId, sessionId: claims.sid };
  assert.equal(hasCurrentPermission(uploadActor, 'station:control'), true);
  await RepositoryFactory.getUserRepository().update(admin.id, { role: 'VIEWER' });
  assert.equal(hasCurrentPermission(uploadActor, 'station:control'), false);
  assert.equal((await request('/logs', authorized)).status, 403);
  assert.equal((await request('/users', { ...authorized, method: 'POST', body: {} })).status, 403);
  assert.equal((await request(selectionPath, { ...authorized, method: 'PUT' })).status, 403);
  assert.equal((await request(stationPath + '/program', { ...authorized, ...audioAction })).status, 403);
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

  const auditRepository = RepositoryFactory.getAuditRepository();
  for (let index = 0; index < 101; index++) {
    await auditRepository.create({ organizationId: admin.organizationId, action: 'TEST_EVENT', resourceType: 'fixture' });
  }
  const foreignEvent = await auditRepository.create({
    organizationId: outsider.organizationId, action: 'TEST_EVENT', resourceType: 'fixture'
  });
  for (const path of ['/logs', '/users']) {
    const forbidden = await request(path);
    assert.equal(forbidden.status, 401);
    assert.equal(forbidden.headers.get('Cache-Control'), 'no-store');
    await forbidden.text();
  }
  for (const query of ['limit=-1', 'limit=0', 'limit=501', 'limit=1.5', 'limit=1&limit=2']) {
    const rejected = await request('/logs?' + query, authorized);
    assert.equal(rejected.status, 400);
    await rejected.text();
  }
  const localEventCount = db.prepare('SELECT count(*) AS count FROM audit_logs WHERE organizationId = ?')
    .get(admin.organizationId).count;
  for (const [path, count] of [['/logs', 100], ['/logs?limit=1', 1], ['/logs?limit=500', localEventCount]]) {
    const results = await request(path, authorized);
    assert.equal(results.status, 200);
    assert.equal(results.headers.get('Cache-Control'), 'no-store');
    const { data } = await results.json();
    assert.equal(data.length, count);
    assert(data.every(event => event.organizationId === admin.organizationId));
  }
  const foreignResults = await request('/logs', { organizationId: outsider.organizationId });
  assert.equal(foreignResults.status, 200);
  assert.deepEqual((await foreignResults.json()).data.map(event => event.id), [foreignEvent.id]);

  const createUser = (email, role = 'VIEWER', extraFields = {}) => request('/users', {
    ...authorized, method: 'POST', body: { fullName: 'Fixture Viewer', email, password: 'Fixture-only-password', role, ...extraFields }
  });
  assert.equal((await createUser('privileged@mcr.local', 'SUPER_ADMIN')).status, 400);
  const extraField = await createUser('extra-field@mcr.local', 'VIEWER', { organizationId: outsider.organizationId });
  assert.equal(extraField.status, 400);
  assert.equal(await RepositoryFactory.getUserRepository().findByEmail('extra-field@mcr.local'), null);
  assert.equal((await createUser('created@mcr.local')).status, 201);
  const created = await RepositoryFactory.getUserRepository().findByEmail('created@mcr.local');
  assert.equal(created.organizationId, admin.organizationId);
  const listed = await request('/users', authorized);
  assert.equal(listed.status, 200);
  assert.equal(listed.headers.get('Cache-Control'), 'no-store');
  const listedUsers = (await listed.json()).data;
  assert(listedUsers.some(user => user.id === created.id));
  assert(listedUsers.every(user => user.id !== outsider.id && !Object.hasOwn(user, 'passwordHash')));
  const events = db.prepare("SELECT * FROM audit_logs WHERE action = 'USER_CREATED'").all();
  assert.equal(events.length, 1);
  assert.equal(events[0].resourceId, created.id);
  assert.equal(events[0].userId, admin.id);
  assert.equal(events[0].organizationId, admin.organizationId);
  assert.deepEqual(JSON.parse(events[0].details), { role: 'VIEWER' });

  db.exec(`CREATE TEMP TRIGGER reject_account_audit BEFORE INSERT ON audit_logs
    WHEN NEW.action = 'USER_CREATED' BEGIN SELECT RAISE(ABORT, 'fixture audit write failed'); END`);
  try {
    const rejected = await createUser('rolled-back@mcr.local');
    assert.equal(rejected.status, 500);
    assert.deepEqual(await rejected.json(), { success: false, error: 'Internal Server Error' });
    assert.equal(await RepositoryFactory.getUserRepository().findByEmail('rolled-back@mcr.local'), null);
  } finally {
    db.exec('DROP TRIGGER reject_account_audit');
  }

  // Four earlier fixture claims count against the same pairing limit.
  const invalidClaim = () => request('/pairing/claim', { method: 'POST', body: {} });
  for (let attempt = 0; attempt < 6; attempt++) {
    const response = await invalidClaim();
    assert.equal(response.status, 400);
    await response.text();
  }
  const throttled = await invalidClaim();
  assert.equal(throttled.status, 429);
  assert(Number(throttled.headers.get('Retry-After')) > 0);
  assert.match((await throttled.json()).error, /pairing attempts/);
  const loginAfterPairingLimit = await login();
  assert.equal(loginAfterPairingLimit.status, 200);
  await loginAfterPairingLimit.text();
});
