import WebSocket from 'ws';
import { EventEmitter } from 'node:events';
import { TelemetryCollector } from './telemetry.js';

export class ServerTunnel extends EventEmitter {
  constructor({ serverUrl, stationId, agentToken, obsAdapter }) {
    super();
    this.serverUrl = serverUrl;
    this.stationId = stationId;
    this.agentToken = agentToken;
    this.obsAdapter = obsAdapter;

    this.ws = null;
    this.isConnected = false;
    this.reconnectTimer = null;
    this.telemetryTimer = null;
    this.reconnectIntervalMs = 3000;
    this.running = false;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._connect();
    this._startTelemetryLoop();
  }

  stop() {
    this.running = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.telemetryTimer) clearInterval(this.telemetryTimer);
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
  }

  _connect() {
    if (this.ws) {
      try { this.ws.close(); } catch {}
    }

    const wsEndpoint = new URL('/agent-ws', this.serverUrl.replace(/^http/, 'ws'));

    try {
      this.ws = new WebSocket(wsEndpoint, {
        headers: {
          'x-station-id': this.stationId,
          'x-agent-token': this.agentToken
        }
      });

      this.ws.on('message', async (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          await this._handleMessage(msg);
        } catch (err) {
          console.error('[Tunnel] Message handle error:', err);
        }
      });

      this.ws.on('close', (code) => {
        this.isConnected = false;
        if (code === 4003 || code === 4004) {
          this.stop();
          this.emit('error', new Error('Agent credentials or station are no longer valid. Pair this device again.'));
          return;
        }
        this.emit('disconnected');
        this._scheduleReconnect();
      });

      this.ws.on('error', (err) => {
        this.isConnected = false;
        this.emit('error', err);
      });
    } catch (err) {
      this._scheduleReconnect();
    }
  }

  _scheduleReconnect() {
    if (!this.running || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this._connect();
    }, this.reconnectIntervalMs);
  }

  _startTelemetryLoop() {
    this.telemetryTimer = setInterval(async () => {
      if (!this.isConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;

      try {
        const sys = TelemetryCollector.getSystemMetrics();
        const obs = await TelemetryCollector.getObsMetrics(this.obsAdapter);

        const telemetryPayload = {
          type: 'TELEMETRY',
          stationId: this.stationId,
          timestamp: new Date().toISOString(),
          data: {
            ...sys,
            ...obs,
            obsConnected: this.obsAdapter?.isConnected || false
          }
        };

        this.ws.send(JSON.stringify(telemetryPayload));
      } catch (err) {
        console.error('[Tunnel] Telemetry send error:', err);
      }
    }, 3000);
  }

  async _handleMessage(msg) {
    if (msg.type === 'HANDSHAKE_ACK') {
      this.isConnected = true;
      this.emit('connected');
      return;
    }
    if (msg.type === 'EXECUTE_COMMAND') {
      const { correlationId, command, params } = msg;

      try {
        if (!this.obsAdapter || !this.obsAdapter.isConnected) {
          throw new Error('OBS Studio is not connected to local agent');
        }

        let result = null;

        switch (command) {
          case 'GetStationSnapshot':
            result = await this.obsAdapter.getStationSnapshot();
            break;
          case 'GetSceneScreenshot':
            result = await this.obsAdapter.getSceneScreenshot(params.preview);
            break;
          case 'SetSceneItemEnabled':
            result = await this.obsAdapter.setSceneItemEnabled(params.sceneName, params.sceneItemId, params.enabled);
            break;
          case 'CutToScene':
            result = await this.obsAdapter.cutToScene(params.sceneName);
            break;
          case 'SetTBarPosition':
            result = await this.obsAdapter.setTBarPosition(params.position, params.release);
            break;
          case 'SetTextInput':
            result = await this.obsAdapter.setTextInput(params.inputName, params.text);
            break;
          case 'SetStudioModeEnabled':
            result = await (params.enabled ? this.obsAdapter.enableStudioMode() : this.obsAdapter.disableStudioMode());
            break;
          case 'SetCurrentSceneTransition':
            result = await this.obsAdapter.setCurrentSceneTransition(params.transitionName);
            break;
          case 'SetCurrentSceneTransitionDuration':
            result = await this.obsAdapter.setCurrentSceneTransitionDuration(params.transitionDuration);
            break;
          case 'GetVersion':
            result = await this.obsAdapter.getVersion();
            break;
          case 'GetStats':
            result = await this.obsAdapter.getStats();
            break;
          case 'GetSceneList':
            result = await this.obsAdapter.getSceneList();
            break;
          case 'SetCurrentProgramScene':
            result = await this.obsAdapter.setCurrentProgramScene(params.sceneName);
            break;
          case 'SetCurrentPreviewScene':
            result = await this.obsAdapter.setCurrentPreviewScene(params.sceneName);
            break;
          case 'StartStream':
            result = await this.obsAdapter.startStream();
            break;
          case 'StopStream':
            result = await this.obsAdapter.stopStream();
            break;
          case 'StartRecord':
            result = await this.obsAdapter.startRecord();
            break;
          case 'StopRecord':
            result = await this.obsAdapter.stopRecord();
            break;
          case 'SetInputVolume':
            result = await this.obsAdapter.setInputVolume(
              params.inputName,
              params.inputVolumeMul,
              params.inputVolumeDb
            );
            break;
          case 'SetInputMute':
            result = await this.obsAdapter.setInputMute(params.inputName, params.inputMuted);
            break;
          case 'TriggerStudioModeTransition':
            result = await this.obsAdapter.triggerStudioModeTransition();
            break;
          default:
            throw new Error(`Unsupported OBS command: ${command}`);
        }

        this.ws.send(JSON.stringify({
          type: 'COMMAND_ACK',
          correlationId,
          result: result || { success: true }
        }));
      } catch (err) {
        this.ws.send(JSON.stringify({
          type: 'COMMAND_ERROR',
          correlationId,
          error: err.message
        }));
      }
    }
  }

  forwardObsEvent(event, data) {
    if (this.isConnected && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'OBS_EVENT',
        event,
        data
      }));
    }
  }
}
