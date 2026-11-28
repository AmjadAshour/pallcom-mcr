import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test('Desktop Security Audit: Preload script enforces contextIsolation and restricted IPC channels', () => {
  const preloadPath = path.resolve(__dirname, '../src/main/preload.js');
  assert.ok(fs.existsSync(preloadPath), 'Preload script must exist');

  const content = fs.readFileSync(preloadPath, 'utf-8');

  // Verify that contextBridge is used to expose safe APIs
  assert.ok(content.includes('contextBridge.exposeInMainWorld'));
  assert.ok(content.includes('ALLOWED_CHANNELS'));

  // Ensure raw ipcRenderer or require is NOT directly exposed
  assert.equal(/contextBridge\.exposeInMainWorld\([^,]+,\s*ipcRenderer\)/.test(content), false);
  assert.equal(/nodeIntegration:\s*true/.test(content), false);

  const mainPath = path.resolve(__dirname, '../src/main/index.js');
  const mainContent = fs.readFileSync(mainPath, 'utf-8');
  assert.match(mainContent, /contextIsolation:\s*true/);
  assert.match(mainContent, /nodeIntegration:\s*false/);
  assert.match(mainContent, /sandbox:\s*true/);
  assert.match(mainContent, /setWindowOpenHandler/);
  assert.match(mainContent, /will-navigate/);
  assert.match(mainContent, /event\.senderFrame\.url/);
});
