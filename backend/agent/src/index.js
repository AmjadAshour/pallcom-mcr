#!/usr/bin/env node
import { ObsClientAdapter } from '@mcr/obs-client';
import { Keystore } from './keystore.js';
import { ServerTunnel } from './server-tunnel.js';
import os from 'node:os';
import { randomUUID } from 'node:crypto';

async function pairDevice(args) {
  const codeIdx = args.indexOf('--code');
  const serverIdx = args.indexOf('--server');

  if (codeIdx === -1 || !args[codeIdx + 1]) {
    console.error('Error: Missing --code <PAIRING_CODE>');
    process.exit(1);
  }

  const code = args[codeIdx + 1];
  const startAfterPairing = args.includes('--start');
  const serverUrl = serverIdx !== -1 && args[serverIdx + 1] ? args[serverIdx + 1] : 'http://localhost:4000';

  console.log(`[MCR Agent] Initiating device pairing with server: ${serverUrl}...`);

  try {
    const res = await fetch(`${serverUrl}/api/v1/pairing/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pairingCode: code,
        machineHostname: os.hostname(),
        osPlatform: os.platform(),
        agentVersion: '1.0.0'
      })
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Pairing failed on server');
    }

    const config = {
      stationId: data.stationId,
      pairingId: randomUUID(),
      agentToken: data.agentToken,
      serverUrl,
      obsPort: data.obsConfig?.port || 4455,
      obsPassword: data.obsConfig?.password || ''
    };

    Keystore.saveConfig(config);
    console.log(`[MCR Agent] Device successfully paired to Station [${data.stationId}]!`);
    if (startAfterPairing) {
      await startDaemon();
    } else {
      console.log('[MCR Agent] Credentials saved. Run "mcr-agent start" to launch the agent.');
    }
  } catch (err) {
    console.error(`[MCR Agent] Pairing error: ${err.message}`);
    process.exit(1);
  }
}

async function startDaemon() {
  const pairedConfig = Keystore.loadConfig();
  const config = pairedConfig || {
    stationId: process.env.STATION_ID,
    agentToken: process.env.AGENT_TOKEN,
    serverUrl: process.env.SERVER_URL || 'http://localhost:4000',
    obsPort: parseInt(process.env.OBS_PORT || '4455', 10),
    obsPassword: process.env.OBS_PASSWORD || ''
  };
  if (!config.stationId || !config.agentToken) {
    console.error('[MCR Agent] Pair this device before starting the agent.');
    process.exitCode = 1;
    return;
  }

  console.log(`[MCR Agent] Starting daemon for Station [${config.stationId}]...`);

  const obsAdapter = new ObsClientAdapter();
  obsAdapter.on('error', (error) => console.warn('[MCR Agent] OBS socket:', error.message));
  const obsUrl = `ws://127.0.0.1:${config.obsPort}`;

  console.log(`[MCR Agent] Connecting to local OBS Studio at ${obsUrl}...`);
  try {
    await obsAdapter.connect(obsUrl, config.obsPassword);
    console.log('[MCR Agent] Connected to OBS Studio v5 WebSocket!');
  } catch (err) {
    console.warn(`[MCR Agent] OBS connection warning: ${err.message}. Will auto-reconnect.`);
  }

  const tunnel = new ServerTunnel({
    serverUrl: config.serverUrl,
    stationId: config.stationId,
    agentToken: config.agentToken,
    obsAdapter
  });

  tunnel.on('connected', () => {
    console.log(`[MCR Agent] Outbound secure tunnel established to ${config.serverUrl}`);
  });

  tunnel.on('disconnected', () => {
    console.warn('[MCR Agent] Tunnel disconnected. Retrying...');
  });
  tunnel.on('error', (error) => console.warn('[MCR Agent] Server tunnel:', error.message));

  // Forward real-time OBS events through the tunnel
  obsAdapter.on('sceneChanged', (data) => tunnel.forwardObsEvent('sceneChanged', data));
  obsAdapter.on('previewSceneChanged', (data) => tunnel.forwardObsEvent('previewSceneChanged', data));
  obsAdapter.on('streamStateChanged', (data) => tunnel.forwardObsEvent('streamStateChanged', data));
  obsAdapter.on('recordStateChanged', (data) => tunnel.forwardObsEvent('recordStateChanged', data));
  obsAdapter.on('inputVolumeChanged', (data) => tunnel.forwardObsEvent('inputVolumeChanged', data));
  obsAdapter.on('inputMuteChanged', (data) => tunnel.forwardObsEvent('inputMuteChanged', data));

  tunnel.start();

  const shutdown = async () => {
    clearInterval(pairingWatcher);
    console.log('\n[MCR Agent] Shutting down daemon gracefully...');
    tunnel.stop();
    await obsAdapter.disconnect();
    process.exit(0);
  };
  const pairingWatcher = pairedConfig && setInterval(() => {
    const latest = Keystore.loadConfig();
    if (latest?.agentToken !== pairedConfig.agentToken || latest?.pairingId !== pairedConfig.pairingId) {
      console.log('[MCR Agent] Pairing changed. Stopping the previous session.');
      void shutdown();
    }
  }, 1000);

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// CLI Command Parser
const args = process.argv.slice(2);
const command = args[0] || 'start';

if (command === 'pair') {
  pairDevice(args);
} else if (command === 'start') {
  startDaemon();
} else {
  console.log('Usage:');
  console.log('  mcr-agent pair --code <PAIRING_CODE> [--server <URL>] [--start]');
  console.log('  mcr-agent start');
}

