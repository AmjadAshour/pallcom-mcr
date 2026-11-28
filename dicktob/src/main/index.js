import { app, BrowserWindow, ipcMain, session } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow = null;
const localPort = Number(process.env.MCR_DESKTOP_PORT || 4000);
const dashboardUrl = process.env.NODE_ENV === 'development'
  ? 'http://localhost:5173'
  : new URL('http://127.0.0.1:' + localPort).origin;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#09090b',
    title: 'PALLCOM MCR — Master Control Room (Offline Edition)',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  // Strict Content Security Policy
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://127.0.0.1:* http://127.0.0.1:*; img-src 'self' data: blob:;"
        ]
      }
    });
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, target) => {
    if (new URL(target).origin !== dashboardUrl) event.preventDefault();
  });
  mainWindow.loadURL(dashboardUrl).catch((error) => console.error('Local MCR server unavailable:', error.message));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Secure IPC Handlers
ipcMain.handle('mcr:api:request', async (event, { endpoint, method = 'GET', data = {} }) => {
  if (event.sender !== mainWindow?.webContents || new URL(event.senderFrame.url).origin !== dashboardUrl) {
    throw new Error('Unauthorized renderer');
  }
  if (typeof endpoint !== 'string') throw new Error('Invalid API endpoint');
  const url = new URL(endpoint, dashboardUrl);
  if (url.origin !== dashboardUrl || !url.pathname.startsWith('/api/v1/') ||
    !['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) throw new Error('Invalid API request');
  const response = await session.defaultSession.fetch(url.toString(), {
    method, credentials: 'include', redirect: 'error',
    headers: method === 'GET' ? undefined : { 'Content-Type': 'application/json', Origin: dashboardUrl },
    body: method === 'GET' ? undefined : JSON.stringify(data)
  });
  return response.json();
});

ipcMain.handle('mcr:system:info', async () => {
  return {
    platform: process.platform,
    version: app.getVersion(),
    offlineMode: true,
    storage: 'SQLite Embedded'
  };
});

ipcMain.handle('mcr:window:minimize', () => mainWindow?.minimize());
ipcMain.handle('mcr:window:maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});
ipcMain.handle('mcr:window:close', () => mainWindow?.close());

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
