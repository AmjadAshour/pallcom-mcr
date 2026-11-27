import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomBytes, X509Certificate } from 'node:crypto';
import { once } from 'node:events';
import { finished } from 'node:stream/promises';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer as createPortReservation, request as httpRequest } from 'node:http';
import { createServer, request as httpsRequest } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import WebSocket, { WebSocketServer } from 'ws';
import { decode, encode } from '@msgpack/msgpack';
import { startFixtureNginx } from './nginx-fixture.js';
import { startDisposableObs } from './start-disposable-obs.js';
import { closeFixtureProcess } from './close-fixture-process.js';

const directory = await mkdtemp(join(tmpdir(), 'mcr-phase-one-tls-'));
const keyPath = join(directory, 'key.pem');
const certPath = join(directory, 'cert.pem');
const secret = () => randomBytes(32).toString('hex');
const waitFor = async (label, probe) => {
  const deadline = Date.now() + 15_000;
  do {
    const result = await probe();
    if (result) return result;
    await delay(100);
  } while (Date.now() < deadline);
  throw new Error(label + ' timed out');
};
const stop = async child => {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const closed = once(child, 'close');
  child.kill();
  await closed;
};
const listen = async server => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
};
const close = server => !server?.listening ? Promise.resolve() : new Promise(resolve => {
  server.close(resolve);
  server.closeAllConnections?.();
});

let web, ingress, nginx, obs, realObs, agent, browser, database;
const useNginx = Boolean(process.env.MCR_TEST_NGINX);
const reservations = useNginx ? [createPortReservation(), createPortReservation()] : [];
const tunnels = new Set();
try {
  execFileSync(process.env.MCR_TEST_OPENSSL || 'openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=127.0.0.1',
    '-addext', 'subjectAltName=IP:127.0.0.1', '-keyout', keyPath, '-out', certPath
  ], { windowsHide: true, stdio: 'pipe' });
  const ca = await readFile(certPath);
  const key = await readFile(keyPath);
  const fixtureClientIP = useNginx ? '127.0.0.1' : '192.0.2.50';
  const headersFor = req => ({ ...req.headers, 'x-forwarded-for': fixtureClientIP, 'x-forwarded-proto': 'https' });
  const forward = req => httpRequest({
    hostname: '127.0.0.1', port: web.address().port, path: req.url, method: req.method, headers: headersFor(req)
  });
  ingress = createServer({ key, cert: ca, minVersion: 'TLSv1.2' }, (req, res) => {
    const upstream = forward(req);
    upstream.on('response', response => {
      res.writeHead(response.statusCode, response.headers);
      response.pipe(res);
    });
    upstream.on('error', () => res.destroy());
    req.pipe(upstream);
  });
  ingress.on('upgrade', (req, socket, head) => {
    tunnels.add(socket);
    socket.once('close', () => tunnels.delete(socket));
    const upstream = forward(req);
    upstream.on('error', () => socket.destroy());
    upstream.on('response', () => socket.destroy());
    upstream.on('upgrade', (response, target, initial) => {
      tunnels.add(target);
      target.once('close', () => { tunnels.delete(target); socket.destroy(); });
      socket.once('close', () => target.destroy());
      target.on('error', () => socket.destroy());
      socket.on('error', () => target.destroy());
      socket.write('HTTP/1.1 101 Switching Protocols\r\n' +
        response.rawHeaders.reduce((lines, value, index) =>
          lines + (index % 2 ? value + '\r\n' : value + ': '), '') + '\r\n');
      if (initial.length) socket.write(initial);
      if (head.length) target.write(head);
      socket.pipe(target).pipe(socket);
    });
    upstream.end();
  });
  const ingressPort = await listen(useNginx ? reservations[0] : ingress);
  const origin = 'https://127.0.0.1:' + ingressPort;
  const password = secret();
  Object.assign(process.env, {
    NODE_ENV: 'production', RENDER: 'false', PORT: '0', MCR_BIND_HOST: '127.0.0.1',
    CORS_ORIGIN: origin, MCR_TRUST_PROXY_CIDRS: '127.0.0.1', MCR_PROGRAM_RUNTIME_PORT: '',
    MCR_ADMIN_PASSWORD: '', LOG_LEVEL: 'silent', STORAGE_MODE: 'sqlite', SQLITE_DB_PATH: join(directory, 'fixture.sqlite'),
    JWT_SECRET: secret(), REFRESH_TOKEN_SECRET: secret(), ENCRYPTION_MASTER_KEY: secret()
  });
  ({ server: web } = await import('../src/index.js'));
  if (!web.address()) await once(web, 'listening');
  if (useNginx) {
    const redirectPort = await listen(reservations[1]);
    await Promise.all(reservations.map(close));
    nginx = await startFixtureNginx({
      directory, port: ingressPort, redirectPort, upstreamPort: web.address().port,
      cert: certPath, key: keyPath, webRoot: fileURLToPath(new URL('../../frontend/dist/', import.meta.url))
    });
  }
  const { RepositoryFactory: repo } = await import('../src/infrastructure/repositories/repository-factory.js');
  const { getSqliteDatabase } = await import('../src/infrastructure/database/sqlite.js');
  const { CryptoService } = await import('../src/infrastructure/security/crypto-service.js');
  database = getSqliteDatabase();
  const email = 'phase-one-staging@fixture.local';
  const user = await repo.getUserRepository().create({
    email, passwordHash: await CryptoService.hashPassword(password), fullName: 'Staging Fixture',
    role: 'SUPER_ADMIN', organizationId: 'phase-one-fixture'
  });
  const exposedBootstrapPassword = ['Admin', '123456', '!'].join('');
  await repo.getUserRepository().create({
    email:'admin@mcrpro.local', passwordHash:await CryptoService.hashPassword(exposedBootstrapPassword),
    fullName:'Legacy bootstrap fixture', role:'SUPER_ADMIN', organizationId:user.organizationId
  });
  function call(path, { method = 'GET', json, headers = {}, certificate = ca } = {}) {
    return new Promise((resolve, reject) => {
      const body = json === undefined ? null : JSON.stringify(json);
      const req = httpsRequest(origin + path, {
        ca: certificate, method, headers: body ? {
          ...headers, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body)
        } : headers, timeout: 5000
      }, response => {
        const protocol = response.socket.getProtocol();
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('error', reject);
        response.on('end', () => resolve({
          status: response.statusCode, headers: response.headers, protocol, body: Buffer.concat(chunks).toString()
        }));
      });
      req.on('timeout', () => req.destroy(new Error('Fixture HTTPS request timed out')));
      req.on('error', reject);
      req.end(body);
    });
  }
  const probePath = useNginx ? '/api/v1/auth/me' : '/health';
  const health = await waitFor('HTTPS fixture ingress', async () => {
    try {
      return await call(probePath);
    } catch (error) {
      if (error.code === 'ECONNREFUSED' && (!nginx || nginx.exitCode === null)) return null;
      throw error;
    }
  });
  assert.equal(health.status, useNginx ? 401 : 200);
  assert.match(health.protocol, /^TLSv1\.[23]$/);
  assert.match(health.headers['content-security-policy'], /script-src 'self'/);
  assert.match(health.headers['strict-transport-security'], /max-age=/);
  await assert.rejects(call(probePath, { certificate: null }), { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' });
  const deniedLegacy = await call('/api/v1/auth/login', {
    method:'POST', json:{ email:'admin@mcrpro.local', password:exposedBootstrapPassword }
  });
  assert.equal(deniedLegacy.status, 401);
  assert.equal(deniedLegacy.headers['set-cookie'], undefined);
  const foreignOrigin = 'https://foreign-origin.invalid';
  const deniedLogin = await call('/api/v1/auth/login', {
    method: 'POST', json: { email, password }, headers: { Origin: foreignOrigin, 'Sec-Fetch-Site': 'cross-site' }
  });
  assert.equal(deniedLogin.status, 403);
  assert.equal(deniedLogin.headers['set-cookie'], undefined);
  const deniedRealtime = await call('/socket.io/?EIO=4&transport=polling', {
    headers: { Origin: foreignOrigin }
  });
  assert.equal(deniedRealtime.status, 403);
  const login = await call('/api/v1/auth/login', {
    method: 'POST', json: { email, password }, headers: { 'X-Forwarded-For': '198.51.100.23' }
  });
  assert.equal(login.status, 200);
  assert.equal(login.headers['set-cookie'].length, 2);
  for (const cookie of login.headers['set-cookie']) {
    assert.match(cookie, /; Secure\b/i);
    assert.match(cookie, /; HttpOnly\b/i);
    assert.match(cookie, /; SameSite=Strict\b/i);
  }
  assert.equal(database.prepare("SELECT ipAddress FROM audit_logs WHERE userId = ? AND action = 'LOGIN_SUCCESS'")
    .get(user.id).ipAddress, fixtureClientIP);
  console.log('Local TLS trust, proxy attribution, origin rejection and secure cookie checks passed');

  const obsPassword = secret();
  let obsPort;
  if (process.env.MCR_TEST_REAL_OBS === '1') {
    const reservation = createPortReservation();
    obsPort = await listen(reservation);
    await close(reservation);
    realObs = await startDisposableObs(directory, obsPort, obsPassword);
  } else {
    obs = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await once(obs, 'listening');
    obsPort = obs.address().port;
    const salt = secret();
    const digest = value => createHash('sha256').update(value).digest('base64');
    obs.on('connection', socket => {
      const challenge = secret();
      let identified = false;
      socket.send(encode({ op: 0, d: {
        obsWebSocketVersion: '5.0.0', rpcVersion: 1, authentication: { challenge, salt }
      } }));
      socket.on('message', raw => {
        const { op, d } = decode(raw);
        if (op === 1) {
          if (d.authentication !== digest(digest(obsPassword + salt) + challenge)) {
            socket.close(4009, 'Fixture OBS authentication failed');
            return;
          }
          identified = true;
          socket.send(encode({ op: 2, d: { negotiatedRpcVersion: 1 } }));
        }
        if (op === 6 && identified) socket.send(encode({ op: 7, d: {
          requestType: d.requestType, requestId: d.requestId, requestStatus: { result: true, code: 100 },
          responseData: d.requestType === 'GetSceneList' ? { scenes: [{ sceneName: 'Fixture Scene' }] } : {}
        } }));
      });
    });
  }
  const station = await repo.getStationRepository().create({
    name: 'Isolated staging station', organizationId: user.organizationId, obsPort,
    encryptedPassword: CryptoService.encryptSecret(obsPassword)
  });
  const token = JSON.parse(login.body).accessToken;
  const bearer = { Authorization: 'Bearer ' + token };
  const paired = await call('/api/v1/pairing/generate', { method: 'POST', json: { stationId: station.id }, headers: bearer });
  assert.equal(paired.status, 201);
  const { pairingCode } = JSON.parse(paired.body);
  agent = spawn(process.execPath, ['backend/agent/src/index.js', 'pair', '--server', origin, '--code', pairingCode, '--start'], {
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NODE_EXTRA_CA_CERTS: certPath, MCR_AGENT_CONFIG_DIR: join(directory, 'agent') }
  });
  let agentOutput = '';
  agent.stdout.on('data', chunk => { agentOutput = (agentOutput + chunk.toString()).slice(-4000); });
  agent.stderr.on('data', chunk => { agentOutput = (agentOutput + chunk.toString()).slice(-4000); });
  try {
    await waitFor('Agent pairing, OBS and WSS', () => {
      if (agent.exitCode !== null) throw new Error('Agent fixture exited before handshake');
      return agentOutput.includes('Connected to OBS Studio') && agentOutput.includes('Outbound secure tunnel established');
    });
  } catch (error) {
    if (agent.exitCode !== null) await Promise.allSettled([finished(agent.stdout), finished(agent.stderr)]);
    console.error(agentOutput.replaceAll(pairingCode, '[redacted]'));
    throw error;
  }
  const scenes = await call('/api/v1/stations/' + station.id + '/scenes', { headers: bearer });
  assert.equal(scenes.status, 200);
  assert.deepEqual(JSON.parse(scenes.body).data.scenes.map(({ sceneName }) => ({ sceneName })),
    realObs?.scenes ?? [{ sceneName: 'Fixture Scene' }]);
  const revoke = await call('/api/v1/stations/' + station.id + '/agent/revoke', { method: 'POST', headers: bearer });
  assert.equal(revoke.status, 200);
  await waitFor('Agent revocation', () => agentOutput.includes('Agent credentials or station are no longer valid'));
  if (realObs) {
    console.log('Real Agent pairing, WSS, scene read and revocation passed with OBS Studio', realObs.version.obsVersion);
  } else {
    console.log('Real Agent CLI pairing, WSS, scene read and revocation passed with simulated OBS');
  }

  const chrome = process.env.MCR_TEST_CHROME;
  if (chrome) {
    const browserProfile = join(directory, 'chromium');
    const spki = new X509Certificate(ca).publicKey.export({ type: 'spki', format: 'der' });
    const pin = createHash('sha256').update(spki).digest('base64');
    browser = spawn(chrome, [
      '--headless', '--no-first-run', '--disable-background-networking', '--disable-sync',
      '--no-proxy-server', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
      '--remote-debugging-port=0', '--user-data-dir=' + browserProfile,
      '--ignore-certificate-errors-spki-list=' + pin, 'about:blank'
    ], { windowsHide: true, stdio: 'ignore' });
    const debugPort = await waitFor('Chromium fixture port', async () => {
      if (browser.exitCode !== null) throw new Error('Chromium fixture exited before startup');
      return readFile(join(browserProfile, 'DevToolsActivePort'), 'utf8').then(body => body.split(/\r?\n/)[0], () => null);
    });
    const pages = await fetch('http://127.0.0.1:' + debugPort + '/json/list').then(response => response.json());
    const client = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
    try {
      await once(client, 'open');
      let nextId = 0;
      const commands = new Map();
      client.on('message', raw => {
        const { id, result, error } = JSON.parse(raw);
        const call = commands.get(id);
        if (!call) return;
        commands.delete(id);
        clearTimeout(call.timeout);
        if (error) call.reject(new Error(error.message));
        else call.resolve(result);
      });
      const send = (method, params) => new Promise((resolve, reject) => {
        const id = ++nextId;
        const timeout = setTimeout(() => {
          commands.delete(id);
          reject(new Error(method + ' timed out'));
        }, 5000);
        commands.set(id, { resolve, reject, timeout });
        client.send(JSON.stringify({ id, method, params }));
      });
      const evaluate = async expression => {
        const response = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
        if (response.exceptionDetails) throw new Error('Browser fixture evaluation failed');
        return response.result.value;
      };
      const navigation = await send('Page.navigate', { url: origin + '/login' });
      assert.equal(navigation.errorText, undefined, 'Chromium could not load the local dashboard');
      await waitFor('Built dashboard on HTTPS', () => evaluate('Boolean(document.getElementById("root")?.children.length)'));
      const result = await evaluate(`(async () => {
        const violation = new Promise(resolve => document.addEventListener('securitypolicyviolation', event => {
          if (event.blockedURI === 'inline') resolve(event.effectiveDirective);
        }, { once: true }));
        const script = document.createElement('script');
        script.textContent = 'globalThis.fixtureInlineExecuted = true';
        document.body.append(script);
        const protection = await Promise.race([violation, new Promise(resolve => setTimeout(resolve, 2000))]);
        const login = await fetch('/api/v1/auth/login', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(${JSON.stringify({ email, password })})
        });
        const body = await login.json();
        const me = await fetch('/api/v1/auth/me');
        const realtime = await new Promise(resolve => {
          const socket = new WebSocket('wss://' + location.host + '/socket.io/?EIO=4&transport=websocket');
          const timeout = setTimeout(() => { socket.close(); resolve(false); }, 2000);
          socket.onmessage = ({ data }) => {
            if (data.startsWith('0')) socket.send('40');
            if (data.startsWith('40')) {
              clearTimeout(timeout);
              socket.close();
              resolve(true);
            }
          };
        });
        return { protection, executed: Boolean(globalThis.fixtureInlineExecuted),
          login: login.status, me: me.status, accessTokenExposed: 'accessToken' in body,
          cookieVisible: document.cookie.includes('mcr_access_token'), realtime };
      })()`);
      assert.equal(result.protection, 'script-src-elem');
      assert.deepEqual(result, {
        protection: 'script-src-elem', executed: false, login: 200, me: 200, accessTokenExposed: false,
        cookieVisible: false, realtime: true
      });
      console.log('Chromium loaded the built dashboard, enforced CSP and authenticated HTTP and WSS with HttpOnly cookies');
    } finally {
      client.terminate();
    }
  } else {
    console.log('Chromium check skipped (set MCR_TEST_CHROME)');
  }
  if (useNginx) console.log('Actual Nginx application TLS and Agent checks passed');
} finally {
  await stop(browser);
  await stop(agent);
  await closeFixtureProcess(realObs?.child, 'OBS Studio');
  for (const socket of tunnels) socket.destroy();
  if (obs) {
    for (const socket of obs.clients) socket.terminate();
    await new Promise(resolve => obs.close(resolve));
  }
  await close(ingress);
  await stop(nginx);
  await Promise.all(reservations.map(close));
  await close(web);
  database?.close();
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
