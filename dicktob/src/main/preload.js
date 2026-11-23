const { contextBridge, ipcRenderer } = require('electron');

// Explicit whitelist of permitted IPC channels
const ALLOWED_CHANNELS = new Set([
  'mcr:api:request',
  'mcr:system:info',
  'mcr:window:minimize',
  'mcr:window:maximize',
  'mcr:window:close'
]);

contextBridge.exposeInMainWorld('mcrDesktop', {
  isOfflineEdition: true,
  version: '1.0.0',

  sendRequest: async (channel, data = {}) => {
    if (!ALLOWED_CHANNELS.has(channel)) {
      throw new Error(`Unauthorized IPC channel: ${channel}`);
    }
    return await ipcRenderer.invoke(channel, data);
  },

  onBroadcastEvent: (callback) => {
    const handler = (event, payload) => callback(payload);
    ipcRenderer.on('mcr:broadcast:event', handler);
    return () => ipcRenderer.removeListener('mcr:broadcast:event', handler);
  }
});
