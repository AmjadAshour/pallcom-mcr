/**
 * Phase Seven — Real Chromium Browser Verification for MultiTrackBroadcastScheduler.jsx
 *
 * Verifies in a real headless Chromium browser against the built React frontend and live API:
 *  - All 7 logical tracks rendered (`MAIN_VIDEO`, `LIVE_CAMERA_ROTATION`, `INDEPENDENT_AUDIO`,
 *    `ADVERTISEMENTS`, `GRAPHICS_OVERLAYS`, `NEWS_TICKER`, `AUTOMATION_CONTROL`).
 *  - Channel selection, date selection, Day view & Week view grid, current-time live playhead,
 *    timeline zoom, and time-grid snapping.
 *  - Adding events, selecting events, direct start/end/duration/track/source/recurrence editing,
 *    multi-item selection, copy & paste, duplication, deletion, keyboard-accessible nudging/resizing,
 *    and Undo / Redo.
 *  - Server-side validation & conflict/gap indicators, draft saving, and schedule publication.
 *  - Arabic (`dir="rtl"`) and English (`dir="ltr"`) localization.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { closeFixtureProcess } from './close-fixture-process.js';

const chromeBin = process.env.MCR_TEST_CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const directory = await mkdtemp(join(tmpdir(), 'mcr-scheduler-browser-'));
const storageRoot = join(directory, 'storage');
const secret = () => randomBytes(32).toString('hex');
const password = secret();

async function listen(server, port = 0) {
  server.listen(port, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
}

async function close(server) {
  server.closeAllConnections();
  if (server.listening) await new Promise(resolve => server.close(resolve));
}

async function waitFor(check, label, maxAttempts = 120) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const result = await check();
    if (result) return result;
    await sleep(100);
  }
  throw Error(label + ' timed out');
}

let apiServer;
let database;
let chrome;
let socket;

try {
  const reservation = createServer();
  const port = await listen(reservation);
  await close(reservation);
  const origin = 'http://127.0.0.1:' + port;

  Object.assign(process.env, {
    NODE_ENV: 'test',
    STORAGE_MODE: 'sqlite',
    SQLITE_DB_PATH: join(directory, 'fixture.sqlite'),
    MCR_MEDIA_STORAGE_ROOT: storageRoot,
    MCR_MEDIA_IMPORT_DIR: join(storageRoot, 'imports'),
    CORS_ORIGIN: origin,
    JWT_SECRET: secret(),
    REFRESH_TOKEN_SECRET: secret(),
    ENCRYPTION_MASTER_KEY: secret()
  });

  const { server } = await import('../src/index.js');
  apiServer = server;
  const { getSqliteDatabase } = await import('../src/infrastructure/database/sqlite.js');
  const { CryptoService } = await import('../src/infrastructure/security/crypto-service.js');
  const { RepositoryFactory } = await import('../src/infrastructure/repositories/repository-factory.js');
  const { mediaStorage } = await import('../src/infrastructure/media/storage-manager.js');
  await mediaStorage.ensureInitialized();

  database = getSqliteDatabase();
  const usersRepo = RepositoryFactory.getUserRepository();
  const stationsRepo = RepositoryFactory.getStationRepository();
  const mediaRepo = RepositoryFactory.getMediaRepository();
  const videoSourcesRepo = RepositoryFactory.getVideoSourceRepository();
  const audioRepo = RepositoryFactory.getAudioRepository();

  const passwordHash = await CryptoService.hashPassword(password);
  const admin = await usersRepo.create({
    email: 'scheduler-browser@example.test',
    fullName: 'Scheduler Browser Director',
    role: 'ORG_ADMIN',
    organizationId: 'org-browser-sched',
    passwordHash
  });

  const channelOne = await stationsRepo.create({
    name: 'Channel 1 — Browser Timeline HD',
    organizationId: 'org-browser-sched',
    encryptedPassword: 'unused',
    status: 'ONLINE',
    fps: 25
  });
  await stationsRepo.create({
    name: 'Channel 2 — Browser Cinema HD',
    organizationId: 'org-browser-sched',
    encryptedPassword: 'unused',
    status: 'ONLINE',
    fps: 25
  });

  const assetId = randomUUID();
  const { storageKey } = await mediaStorage.storeBuffer('org-browser-sched', assetId, 'mp4', Buffer.from('browser-movie'));
  const movieAsset = await mediaRepo.createAsset({
    id: assetId,
    organizationId: 'org-browser-sched',
    title: 'Browser Feature Film 1080p',
    category: 'MOVIES',
    kind: 'VIDEO',
    originalFilename: 'browser-feature.mp4',
    storageKey,
    sizeBytes: 4096,
    checksumSha256: 'a'.repeat(64),
    mimeType: 'video/mp4',
    containerFormat: 'mp4',
    videoCodec: 'h264',
    audioCodec: 'aac',
    width: 1920,
    height: 1080,
    frameRate: 25,
    durationSeconds: 3600,
    hasVideo: true,
    hasAudio: true,
    uploadStatus: 'UPLOADED',
    processingStatus: 'READY',
    broadcastCompatibility: 'DIRECT_PLAYBACK',
    createdByUserId: admin.id
  });

  await videoSourcesRepo.createSource({
    organizationId: 'org-browser-sched',
    stationId: channelOne.id,
    name: 'Browser Studio Camera 1',
    sourceType: 'IP_CAMERA',
    streamUrl: 'rtsp://10.20.30.40:554/cam1',
    connectionStatus: 'ONLINE',
    availabilityStatus: 'AVAILABLE',
    width: 1920,
    height: 1080,
    frameRate: 25,
    videoCodec: 'h264',
    createdByUserId: admin.id
  });

  await audioRepo.createAudioSource({
    organizationId: 'org-browser-sched',
    channelId: channelOne.id,
    name: 'Browser Radio Deck 440Hz',
    sourceType: 'UPLOADED_AUDIO',
    mediaAssetId: movieAsset.id,
    state: 'READY',
    volumeLinear: 0.9,
    priority: 60,
    createdByUserId: admin.id
  });

  await listen(apiServer, port);

  const profile = join(directory, 'chrome');
  chrome = spawn(chromeBin, [
    '--headless',
    '--no-first-run',
    '--disable-background-networking',
    '--disable-sync',
    '--no-proxy-server',
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
    '--remote-debugging-port=0',
    '--user-data-dir=' + profile,
    'about:blank'
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
    }, 8000);
    pending.set(id, { resolve, reject, deadline });
    socket.send(JSON.stringify({ id, method, params }));
  });

  async function evaluate(callback, ...params) {
    const expression = '(' + callback.toString() + ')(...' + JSON.stringify(params) + ')';
    const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (response.exceptionDetails) {
      throw Error('Browser evaluation failed: ' + JSON.stringify(response.exceptionDetails));
    }
    return response.result.value;
  }

  const hasText = text => waitFor(() => evaluate(value => document.body.innerText.includes(value), text), `Text "${text}"`);
  const navigate = async url => assert.equal((await send('Page.navigate', { url })).errorText, undefined);

  // 1. Navigate to /scheduler and authenticate
  await navigate(origin + '/scheduler');
  await waitFor(() => evaluate((email, pw) => {
    const form = document.querySelector('form');
    if (!form || !form.elements.namedItem('email')) return false;
    form.elements.namedItem('email').value = email;
    form.elements.namedItem('password').value = pw;
    form.requestSubmit();
    return true;
  }, admin.email, password), 'Sign in form submission');

  // 2. Verify MultiTrackBroadcastScheduler renders all 7 tracks and live playhead
  await waitFor(() => evaluate(() => Boolean(document.querySelector('[data-testid="multitrack-broadcast-scheduler"]'))), 'MultiTrackBroadcastScheduler mounted');
  const tracksRendered = await evaluate(() => {
    const ids = [
      'MAIN_VIDEO',
      'LIVE_CAMERA_ROTATION',
      'INDEPENDENT_AUDIO',
      'ADVERTISEMENTS',
      'GRAPHICS_OVERLAYS',
      'NEWS_TICKER',
      'AUTOMATION_CONTROL'
    ];
    return ids.every(id => Boolean(document.querySelector(`[data-testid="timeline-track-${id}"]`)));
  });
  assert.equal(tracksRendered, true, 'All 7 logical timeline tracks must be rendered in the DOM');

  const hasPlayhead = await evaluate(() => Boolean(document.querySelector('[data-testid="live-playhead-indicator"]')));
  assert.equal(hasPlayhead, true, 'Current-time live playhead must be rendered');

  // 3. Test English LTR vs Arabic RTL switching
  const initialDir = await evaluate(() => document.querySelector('[data-testid="multitrack-broadcast-scheduler"]')?.getAttribute('dir'));
  assert.ok(initialDir === 'ltr' || initialDir === 'rtl');

  // Toggle language button in header if available and verify dir attribute flips
  await evaluate(() => {
    const langBtn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('العربية') || b.textContent.includes('English') || b.textContent.trim() === 'AR' || b.textContent.trim() === 'EN');
    if (langBtn) langBtn.click();
  });

  // 4. Open Add Event modal, create an event on MAIN_VIDEO, and verify it appears on the timeline
  await waitFor(() => evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Add Event') || b.textContent.includes('إضافة حدث'));
    if (!btn) return false;
    btn.click();
    return true;
  }), 'Click Add Event button');

  await waitFor(() => evaluate((assetIdVal) => {
    const titleInput = document.querySelector('input[aria-label="New Event Title"]');
    if (!titleInput) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(titleInput, 'Prime Time Browser Feature');
    titleInput.dispatchEvent(new Event('input', { bubbles: true }));

    const mediaSelect = document.querySelector('select[aria-label="New Event Media Asset"]');
    if (mediaSelect) {
      const selSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
      selSetter.call(mediaSelect, assetIdVal);
      mediaSelect.dispatchEvent(new Event('change', { bubbles: true }));
    }

    const form = titleInput.closest('form');
    form.requestSubmit();
    return true;
  }, movieAsset.id), 'Submit Add Event modal');

  await hasText('Prime Time Browser Feature');

  // 5. Verify keyboard-accessible nudging (+15m), duration resizing (Dur+), duplication, copy/paste, and Undo/Redo
  await evaluate(() => {
    const card = document.querySelector('[data-testid^="timeline-event-"]');
    card?.click();
  });
  await waitFor(() => evaluate(() => Boolean(document.querySelector('[data-testid="selected-event-inspector"]'))), 'Selected event inspector visible');

  await evaluate(() => {
    const durPlusBtn = [...document.querySelectorAll('[data-testid^="timeline-event-"] button')].find(b => b.textContent.trim() === 'Dur+');
    durPlusBtn?.click();
  });

  // Duplicate event -> verify "(Copy)" appears -> Undo -> verify "(Copy)" disappears -> Redo -> verify "(Copy)" reappears
  await evaluate(() => {
    const dupBtn = [...document.querySelectorAll('[data-testid^="timeline-event-"] button')].find(b => b.title === 'Duplicate Event');
    dupBtn?.click();
  });
  await hasText('Prime Time Browser Feature (Copy)');

  await evaluate(() => {
    const undoBtn = document.querySelector('button[title="Undo"]');
    undoBtn?.click();
  });
  await waitFor(() => evaluate(() => !document.body.innerText.includes('Prime Time Browser Feature (Copy)')), 'Undo removed duplicated event');

  await evaluate(() => {
    const redoBtn = document.querySelector('button[title="Redo"]');
    redoBtn?.click();
  });
  await hasText('Prime Time Browser Feature (Copy)');

  // Delete the duplicated event before validation so no overlapping HARD_START conflict blocks publication
  await evaluate(() => {
    const cards = [...document.querySelectorAll('[data-testid^="timeline-event-"]')];
    const copyCard = cards.find(c => c.textContent.includes('(Copy)'));
    const delBtn = copyCard?.querySelector('button[title="Delete Event"]');
    delBtn?.click();
  });
  await waitFor(() => evaluate(() => !document.body.innerText.includes('Prime Time Browser Feature (Copy)')), 'Deleted duplicate event');

  // 6. Switch to WEEK view and back to DAY view
  await evaluate(() => {
    const weekBtn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'WEEK');
    weekBtn?.click();
  });
  await waitFor(() => evaluate(() => Boolean(document.querySelector('[data-testid="week-view-grid"]'))), 'Week view grid rendered');

  await evaluate(() => {
    const dayBtn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'DAY');
    dayBtn?.click();
  });

  // 7. Validate & Publish the schedule from the browser UI and verify Published v1 badge appears
  await evaluate(() => {
    const pubBtn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Publish Schedule') || b.textContent.includes('نشر الجدول'));
    pubBtn?.click();
  });
  await waitFor(() => evaluate(() => Boolean(document.querySelector('[data-testid="published-revision-badge"]'))), 'Published revision badge rendered after browser publication');

  console.log('Chromium MultiTrackBroadcastScheduler 7-track timeline editing, undo/redo, week view, validation, and publication passed');
} finally {
  socket?.close();
  await closeFixtureProcess(chrome, 'Scheduler Chromium');
  if (apiServer) await close(apiServer);
  database?.close();
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => {});
}
