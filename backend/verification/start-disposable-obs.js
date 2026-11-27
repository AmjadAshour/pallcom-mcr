import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import OBSWebSocket from 'obs-websocket-js';
import { closeFixtureProcess } from './close-fixture-process.js';

export async function startDisposableObs(directory, port, password) {
  assert.equal(process.platform, 'linux');
  assert(!Object.values(networkInterfaces()).flat().some(address => !address.internal),
    'Real OBS verification requires a disposable network namespace with only loopback');
  assert(process.env.DISPLAY, 'The fixture requires an isolated virtual display');
  const home = join(directory, 'obs-home');
  const config = join(home, '.config');
  const profile = join(config, 'obs-studio');
  const websocket = join(profile, 'plugin_config', 'obs-websocket');
  await mkdir(websocket, { recursive: true, mode: 0o700 });
  await writeFile(join(profile, 'global.ini'), [
    '[General]', 'FirstRun=true', '[OBSWebSocket]', 'FirstLoad=false', 'ServerEnabled=true',
    'AuthRequired=true', 'ServerPort=' + port, 'ServerPassword=' + password, ''
  ].join('\n'), { mode: 0o600 });
  await writeFile(join(websocket, 'config.json'), JSON.stringify({
    first_load: false, server_enabled: true, server_port: port, auth_required: true, server_password: password,
  }), { mode: 0o600 });
  const child = spawn('obs', ['--multi', '--disable-updater', '--disable-missing-files-check', '--websocket_ipv4_only'], {
    env: { PATH: process.env.PATH, DISPLAY: process.env.DISPLAY, HOME: home, XDG_CONFIG_HOME: config,
      XAUTHORITY: process.env.XAUTHORITY, LIBGL_ALWAYS_SOFTWARE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', chunk => { output = (output + chunk.toString()).slice(-8000); });
  }
  let startError;
  child.once('error', error => { startError = error; });
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline && !startError && child.exitCode === null) {
    const api = new OBSWebSocket();
    try {
      await api.connect('ws://127.0.0.1:' + port, password, { rpcVersion: 1 });
      const version = await api.call('GetVersion');
      const result = await api.call('GetSceneList');
      assert(version.obsVersion && version.obsWebSocketVersion);
      assert(Array.isArray(result.scenes) && result.scenes.length > 0);
      return { child, version, scenes: result.scenes.map(({ sceneName }) => ({ sceneName })) };
    } catch {
      await sleep(250);
    } finally {
      await api.disconnect().catch(() => {});
    }
  }
  console.error(output.replaceAll(password, '[fixture password]'));
  await closeFixtureProcess(child, 'OBS Studio');
  throw new Error('Disposable OBS Studio was not ready for an authenticated scene read', { cause: startError });
}
