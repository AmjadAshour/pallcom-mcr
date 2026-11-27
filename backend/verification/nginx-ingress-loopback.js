import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { request } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { startFixtureNginx } from './nginx-fixture.js';

const dir = await mkdtemp(join(tmpdir(), 'mcr-nginx-'));
const cert = join(dir, 'cert.pem');
const key = join(dir, 'key.pem');
const secret = randomBytes(32).toString('hex');

async function listen(server) {
  await new Promise((ready, reject) => {
    server.once('error', reject).listen(0, '127.0.0.1', ready);
  });
  return server.address().port;
}

async function close(server) {
  if (server.listening) await new Promise(done => server.close(done));
}

const upstream = createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ path: req.url, peer: req.headers['x-forwarded-for'], scheme: req.headers['x-forwarded-proto'] }));
});
const proxyPort = createServer();
const redirectPort = createServer();
let child;
try {
  const upstreamPort = await listen(upstream);
  const tlsPort = await listen(proxyPort);
  const httpPort = await listen(redirectPort);
  await writeFile(join(dir, 'index.html'), 'fixture');
  execFileSync(process.env.MCR_TEST_OPENSSL || 'openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=127.0.0.1',
    '-addext', 'subjectAltName=IP:127.0.0.1', '-keyout', key, '-out', cert,
  ], { stdio: 'pipe', windowsHide: true });
  const ca = await readFile(cert);
  await close(proxyPort);
  await close(redirectPort);
  child = await startFixtureNginx({
    directory: dir, webRoot: dir, port: tlsPort, redirectPort: httpPort, upstreamPort, cert, key
  });

  const call = path => new Promise((done, reject) => {
    const req = request({
      hostname: '127.0.0.1', port: tlsPort, path, ca, agent: false,
      headers: { 'X-Forwarded-For':'192.0.2.60', 'X-Forwarded-Proto':'http' }
    }, res => {
      res.setEncoding('utf8');
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => done({ status: res.statusCode, headers: res.headers, body }));
      res.on('error', reject);
    });
    req.setTimeout(6000, () => req.destroy(new Error('Nginx fixture timed out for ' + path.replaceAll(secret, '[fixture credential]'))));
    req.on('error', reject);
    req.end();
  });

  const control = '/api/fixture-control';
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await call(control);
      assert.equal(response.status, 200);
      assert.equal(response.headers['strict-transport-security'], 'max-age=31536000');
      assert.match(response.headers['content-security-policy'], /default-src 'self'/);
      assert.deepEqual(JSON.parse(response.body), { path: control, peer:'127.0.0.1', scheme:'https' });
      break;
    } catch (error) {
      if (error.code !== 'ECONNREFUSED' || attempt >= 20) throw error;
      await delay(100);
    }
  }
  const redirect = await fetch('http://127.0.0.1:' + httpPort + control, { redirect:'manual' });
  assert.equal(redirect.status, 308);
  assert.match(redirect.headers.get('location'), /^https:\/\/127\.0\.0\.1\//);
  await redirect.arrayBuffer();
  for (const path of ['/iptv', '/iptv/program.m3u8', '/iptv/segment-123.ts']) {
    assert.equal((await call(path)).status, 404);
  }
  const protectedPaths = [
    { name:'graphics', path:'/api/v1/public/graphics/' + secret },
    { name:'signed HLS', path:'/api/v1/stations/fixture/program/hls/session/play/' + secret + '/index.m3u8' },
  ];
  assert.equal((await call('/broadcast-overlay/' + secret)).status, 200);
  for (const { name, path } of protectedPaths) {
    const response = await call(path);
    assert.equal(response.status, 200, name + ' must reach the upstream');
    const { peer, scheme } = JSON.parse(response.body);
    assert.equal(peer, '127.0.0.1');
    assert.equal(scheme, 'https');
  }
  assert.equal((await call('/api/v1/stations/fixture/program/local-scene/video')).status, 200,
    'Local-scene upload location must reach the upstream');
  await close(upstream);
  for (const path of [...protectedPaths.map(item => item.path), control]) {
    assert([502, 504].includes((await call(path)).status), 'Unavailable upstream must yield a gateway error');
  }
  const access = await readFile(join(dir, 'logs/access.log'), 'utf8');
  const errors = await readFile(join(dir, 'logs/error.log'), 'utf8');
  for (const [kind, log] of [['access', access], ['error', errors]]) {
    assert(log.includes(control), 'Expected a non-sensitive positive ' + kind + ' log control');
    assert(!log.includes(secret), 'A synthetic credential was present in the gateway ' + kind + ' log');
  }
  console.log('Nginx loopback ingress and log checks passed');
} finally {
  if (child && child.exitCode === null && child.signalCode === null) {
    const stopped = once(child, 'close');
    child.kill();
    await stopped;
  }
  await Promise.all([close(upstream), close(proxyPort), close(redirectPort)]);
  await rm(dir, { recursive:true, force:true, maxRetries:5, retryDelay:100 });
}
