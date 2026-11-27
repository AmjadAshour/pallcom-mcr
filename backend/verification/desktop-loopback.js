import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeFixtureProcess } from './close-fixture-process.js';

const workspace = new URL('../../dicktob/', import.meta.url);
const requireDesktop = createRequire(new URL('package.json', workspace));
const electron = requireDesktop('electron');
const profile = await mkdtemp(join(tmpdir(), 'mcr-electron-smoke-'));
const result = Promise.withResolvers();
const html = '<!doctype html><meta charset="utf-8"><script src="/fixture.js" defer></script>';
const script = `
  (async () => {
    let rejected = false;
    try { await window.mcrDesktop.sendRequest('fixture:invalid-channel'); } catch { rejected = true; }
    const info = await window.mcrDesktop.sendRequest('mcr:system:info');
    await fetch('/result', { method: 'POST', body: JSON.stringify({
      nodeHidden: typeof require === 'undefined' && typeof process === 'undefined',
      invalidChannelRejected: rejected, offlineMode: info.offlineMode,
    }) });
  })().catch(() => fetch('/result', { method: 'POST', body: '{"rendererError":true}' }));
`;
const server = createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/result') {
    const buffer = [];
    for await (const chunk of req) {
      buffer.push(chunk);
      if (buffer.length > 16) { res.writeHead(400).end(); return; }
    }
    res.writeHead(204).end();
    result.resolve(Buffer.concat(buffer).toString());
    return;
  }
  if (req.url === '/fixture.js') res.writeHead(200, { 'Content-Type': 'application/javascript' }).end(script);
  else res.writeHead(200, { 'Content-Type': 'text/html' }).end(html);
});
let child;
let deadline;
try {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  child = spawn(electron, ['--disable-background-networking', '--user-data-dir=' + profile, fileURLToPath(workspace)], {
    env: { ...process.env, NODE_ENV: 'production', MCR_DESKTOP_PORT: String(server.address().port) },
    cwd: fileURLToPath(workspace), stdio: 'ignore', windowsHide: true,
  });
  child.once('error', result.reject);
  child.once('close', code => result.reject(new Error('Electron fixture exited before renderer proof with code ' + code)));
  deadline = setTimeout(() => result.reject(new Error('Electron fixture renderer proof timed out')), 30000);
  assert.deepEqual(JSON.parse(await result.promise), {
    nodeHidden: true,
    invalidChannelRejected: true,
    offlineMode: true,
  });
  console.log('Real Electron renderer isolation, allowed IPC and denied IPC smoke passed');
} finally {
  clearTimeout(deadline);
  await closeFixtureProcess(child, 'Electron');
  server.closeAllConnections();
  if (server.listening) await new Promise(resolve => server.close(resolve));
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
