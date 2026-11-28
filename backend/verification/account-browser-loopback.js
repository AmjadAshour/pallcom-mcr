import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { closeFixtureProcess } from './close-fixture-process.js';
import { base32, totpCode } from '../src/infrastructure/security/totp.js';

assert(process.env.MCR_TEST_CHROME, 'Set MCR_TEST_CHROME to the local Chromium executable.');
const directory = await mkdtemp(join(tmpdir(), 'mcr-account-browser-'));
const secret = () => randomBytes(32).toString('hex');
const password = secret();
const replacement = secret();
const deliveryKey = secret();
const delivered = [];
const delivery = createServer(async (req, res) => {
  if (req.method !== 'POST' || req.url !== '/reset' || req.headers.authorization !== 'Bearer ' + deliveryKey) {
    res.writeHead(401).end();
    return;
  }
  const buffers = [];
  for await (const chunk of req) buffers.push(chunk);
  delivered.push(JSON.parse(Buffer.concat(buffers)));
  res.writeHead(204).end();
});

async function listen(server, port = 0) {
  server.listen(port, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
}

async function close(server) {
  server.closeAllConnections();
  if (server.listening) await new Promise(resolve => server.close(resolve));
}

async function waitFor(check, label) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const result = await check();
    if (result) return result;
    await sleep(100);
  }
  throw Error(label + ' timed out');
}

let api;
let database;
let chrome;
let socket;
try {
  const reservation = createServer();
  const port = await listen(reservation);
  await close(reservation);
  const origin = 'http://127.0.0.1:' + port;
  const deliveryPort = await listen(delivery);
  Object.assign(process.env, {
    NODE_ENV: 'test', STORAGE_MODE: 'sqlite', SQLITE_DB_PATH: join(directory, 'fixture.sqlite'),
    CORS_ORIGIN: origin, JWT_SECRET: secret(), REFRESH_TOKEN_SECRET: secret(), ENCRYPTION_MASTER_KEY: secret(),
    MCR_PASSWORD_RESET_DELIVERY_URL: 'http://127.0.0.1:' + deliveryPort + '/reset',
    MCR_PASSWORD_RESET_DELIVERY_KEY: deliveryKey
  });
  const { server } = await import('../src/index.js');
  api = server;
  const { getSqliteDatabase } = await import('../src/infrastructure/database/sqlite.js');
  const { CryptoService } = await import('../src/infrastructure/security/crypto-service.js');
  const { SqliteUserRepository } = await import('../src/infrastructure/repositories/sqlite-user-repository.js');
  database = getSqliteDatabase();
  const users = new SqliteUserRepository();
  const passwordHash = await CryptoService.hashPassword(password);
  const admin = await users.create({
    email: 'browser-admin@example.test', fullName: 'Browser admin', role: 'ORG_ADMIN', organizationId: 'fixture', passwordHash
  });
  const operator = await users.create({
    email: 'browser-operator@example.test', fullName: 'Browser operator', role: 'VIEWER', organizationId: 'fixture', passwordHash
  });
  await listen(api, port);

  const profile = join(directory, 'chrome');
  chrome = spawn(process.env.MCR_TEST_CHROME, [
    '--headless', '--no-first-run', '--disable-background-networking', '--disable-sync', '--no-proxy-server',
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', '--remote-debugging-port=0',
    '--user-data-dir=' + profile, 'about:blank'
  ], { windowsHide: true, stdio: 'ignore' });
  const debugPort = await waitFor(async () => {
    if (chrome.exitCode !== null) throw Error('Chromium exited before startup.');
    return readFile(join(profile, 'DevToolsActivePort'), 'utf8').then(value => value.split(/\r?\n/)[0], () => null);
  }, 'Chromium startup');
  const pages = await fetch('http://127.0.0.1:' + debugPort + '/json/list', { signal: AbortSignal.timeout(4000) })
    .then(response => response.json());
  socket = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
  await once(socket, 'open', { signal: AbortSignal.timeout(5000) });
  let commandId = 0;
  const pending = new Map();
  socket.addEventListener('message', ({ data }) => {
    const reply = JSON.parse(data);
    const command = pending.get(reply.id);
    if (!command) return;
    pending.delete(reply.id);
    clearTimeout(command.deadline);
    if (reply.error) command.reject(Error(reply.error.message));
    else command.resolve(reply.result);
  });
  const send = (method, params) => new Promise((resolve, reject) => {
    const id = ++commandId;
    const deadline = setTimeout(() => {
      pending.delete(id);
      reject(Error(method + ' timed out'));
    }, 5000);
    pending.set(id, { resolve, reject, deadline });
    socket.send(JSON.stringify({ id, method, params }));
  });
  async function evaluate(callback, ...params) {
    const expression = '(' + callback.toString() + ')(...' + JSON.stringify(params) + ')';
    const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (response.exceptionDetails) throw Error('Browser fixture evaluation failed.');
    return response.result.value;
  }
  const hasText = text => waitFor(() => evaluate(value => document.body.innerText.includes(value), text), text);
  const press = (name, within) => waitFor(() => evaluate((label, scope) => {
    const parent = scope ? document.querySelector(scope) : document;
    const button = [...(parent?.querySelectorAll('button') ?? [])]
      .find(candidate => !candidate.disabled && candidate.textContent.trim() === label);
    if (!button) return false;
    button.click();
    return true;
  }, name, within), name);
  const submit = (fields, within) => waitFor(() => evaluate((values, scope) => {
    const parent = scope ? document.querySelector(scope) : document;
    const names = Object.keys(values);
    const form = [...(parent?.querySelectorAll('form') ?? [])]
      .find(candidate => names.every(name => candidate.elements.namedItem(name)) &&
        (!candidate.elements.namedItem('fullName') || names.includes('fullName')));
    if (!form || form.querySelector('button:not([type]),button[type="submit"]')?.disabled) return false;
    for (const name of names) form.elements.namedItem(name).value = values[name];
    form.requestSubmit();
    return true;
  }, fields, within), 'Form submission for ' + Object.keys(fields).join(', '));
  const navigate = async url => assert.equal((await send('Page.navigate', { url })).errorText, undefined);

  await navigate(origin + '/users');
  await submit({ email: admin.email, password });
  await hasText(operator.email);
  await submit({
    fullName: 'Browser created viewer',
    email: 'browser-created@example.test',
    password,
    role: 'VIEWER',
    currentPassword: password
  });
  await hasText('browser-created@example.test · VIEWER · Active');
  await evaluate(targetEmail => {
    const item = [...document.querySelectorAll('li')].find(candidate => candidate.textContent.includes(targetEmail));
    const button = [...(item?.querySelectorAll('button') ?? [])].find(candidate => candidate.textContent.trim() === 'Change role');
    button?.click();
  }, operator.email);
  await submit({ role: 'OPERATOR', currentPassword: password });
  await hasText(operator.email + ' · OPERATOR');
  await press('Sign out');
  await hasText('Sign in');
  await navigate(origin + '/settings');
  await submit({ email: operator.email, password });

  const mfaForm = 'section:has(input[name="currentPassword"])';
  await hasText('Set up two-factor authentication');
  await submit({ currentPassword: password }, mfaForm);
  const readSetup = () => waitFor(() => evaluate(scope => document.querySelector(scope + ' code')?.textContent, mfaForm), 'Setup key');
  const firstSetup = await readSetup();
  await press('Restart setup', mfaForm);
  await submit({ currentPassword: password }, mfaForm);
  const secondSetup = await readSetup();
  assert(firstSetup !== secondSetup, 'Restart should issue a new setup key.');
  const factor = database.prepare('SELECT encryptedSecret FROM auth_mfa WHERE userId = ?').get(operator.id);
  const key = Buffer.from(CryptoService.decryptSecret(factor.encryptedSecret), 'hex');
  assert(base32(key) === secondSetup, 'Authenticator setup key did not match registration.');
  await submit({ currentPassword: password, secondFactor: totpCode(key, Math.floor(Date.now() / 30000)) }, mfaForm);
  await hasText('Save these recovery codes now.');
  const codes = await evaluate(() => [...document.querySelectorAll('section li.font-mono')].map(item => item.textContent));
  assert.equal(codes.length, 8);
  await press('Saved, sign in again');
  await submit({ email: operator.email, password });
  await hasText('Verification or recovery code');
  await submit({ secondFactor: codes[0] });
  await hasText('Disable two-factor authentication');
  await press('Sign out');

  await press('Forgot password?');
  await submit({ email: operator.email });
  await hasText('If the account is eligible');
  const notice = await waitFor(() => delivered[0], 'Local reset delivery');
  assert.equal(notice.email, operator.email);
  assert.equal(new URL(notice.resetUrl).origin, origin);
  await navigate(notice.resetUrl);
  await waitFor(() => evaluate(() => location.hash === '' && Boolean(document.querySelector('[name=newPassword]'))), 'Reset link removed from address');
  await submit({ newPassword: replacement });
  await hasText('Password changed. Sign in with the new password.');
  await submit({ email: operator.email, password: replacement });
  await hasText('Verification or recovery code');
  await submit({ secondFactor: codes[0] });
  await waitFor(() => database.prepare(
    "SELECT id FROM audit_logs WHERE userId = ? AND action = 'LOGIN_FAILED'"
  ).get(operator.id), 'Rejected replay audit');
  await hasText('Enter a verification or recovery code.');
  await submit({ secondFactor: codes[1] });
  await hasText('Sign out');
  await navigate(origin + '/settings');
  await hasText('Disable two-factor authentication');
  console.log('Chromium role editing, MFA enrollment and recovery, and password reset passed');
} finally {
  socket?.close();
  await closeFixtureProcess(chrome, 'Account Chromium');
  if (api) await close(api);
  await close(delivery);
  database?.close();
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
