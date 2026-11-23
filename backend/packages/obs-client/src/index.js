import { EventSubscription, OBSWebSocket } from 'obs-websocket-js';
import { EventEmitter } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';

/**
 * Robust OBS Studio WebSocket v5 Adapter
 */
export class ObsClientAdapter extends EventEmitter {
  constructor(options = {}) {
    super();
    this.obs = new OBSWebSocket();
    this.isConnected = false;
    this.options = {
      reconnectIntervalMs: options.reconnectIntervalMs || 3000,
      maxReconnectAttempts: options.maxReconnectAttempts ?? Infinity,
      ...options
    };
    this.currentConnection = null;
    this.audioLevels = new Map();
    this.playoutCue = null;
    this.reconnectTimer = null;
    this.reconnectAttempts = 0;
    this._bindEvents();
  }

  _bindEvents() {
    this.obs.on('ConnectionClosed', (error) => {
      this.isConnected = false;
      this.audioLevels.clear();
      this.playoutCue = null;
      this.emit('disconnected', error);
      this._scheduleReconnect();
    });

    this.obs.on('ConnectionError', (error) => {
      this.isConnected = false;
      this.emit('error', error);
    });

    // Real-time OBS events mapped to standardized payloads
    this.obs.on('CurrentProgramSceneChanged', (data) => {
      this.emit('sceneChanged', { sceneName: data.sceneName, isPreview: false });
    });

    this.obs.on('CurrentPreviewSceneChanged', (data) => {
      this.emit('previewSceneChanged', { sceneName: data.sceneName, isPreview: true });
    });

    this.obs.on('StreamStateChanged', (data) => {
      this.emit('streamStateChanged', {
        active: data.outputActive,
        state: data.outputState
      });
    });

    this.obs.on('RecordStateChanged', (data) => {
      this.emit('recordStateChanged', {
        active: data.outputActive,
        state: data.outputState,
        outputPath: data.outputPath
      });
    });

    this.obs.on('InputVolumeChanged', (data) => {
      this.emit('inputVolumeChanged', {
        inputName: data.inputName,
        volumeMul: data.inputVolumeMul,
        volumeDb: data.inputVolumeDb
      });
    });

    this.obs.on('InputMuteStateChanged', (data) => {
      this.emit('inputMuteChanged', {
        inputName: data.inputName,
        muted: data.inputMuted
      });
    });

    this.obs.on('InputVolumeMeters', ({ inputs }) => {
      const toDb = (value) => Math.max(-60, 20 * Math.log10(value || 0));
      for (const { inputName, inputLevelsMul } of inputs) {
        this.audioLevels.set(inputName, {
          levelDb: toDb(Math.max(...inputLevelsMul.map(([level]) => level))),
          peakDb: toDb(Math.max(...inputLevelsMul.map(([, peak]) => peak)))
        });
      }
    });

    this.obs.on('MediaInputPlaybackEnded', ({ inputName }) => {
      this.emit('mediaPlaybackEnded', { inputName });
    });

    this.obs.on('SceneItemEnableStateChanged', (data) => {
      this.emit('sceneItemStateChanged', {
        sceneName: data.sceneName,
        sceneItemId: data.sceneItemId,
        enabled: data.sceneItemEnabled
      });
    });
  }

  async connect(url = 'ws://127.0.0.1:4455', password = '') {
    if (this.isConnected) return true;
    this.currentConnection = { url, password };

    try {
      await this.obs.connect(url, password || undefined, {
        rpcVersion: 1,
        eventSubscriptions: EventSubscription.All | EventSubscription.InputVolumeMeters
      });
      this.isConnected = true;
      this.reconnectAttempts = 0;
      this.emit('connected', { url });
      return true;
    } catch (err) {
      this.isConnected = false;
      this.emit('connectionFailed', err);
      this._scheduleReconnect();
      throw err;
    }
  }

  async disconnect() {
    this.currentConnection = null;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.isConnected) {
      await this.obs.disconnect();
      this.isConnected = false;
    }
  }

  _scheduleReconnect() {
    if (!this.currentConnection || this.reconnectTimer) return;
    if (this.reconnectAttempts >= this.options.maxReconnectAttempts) {
      this.emit('reconnectExhausted');
      return;
    }

    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        await this.connect(this.currentConnection.url, this.currentConnection.password);
      } catch (err) {
        // Will trigger ConnectionClosed or error and schedule again
      }
    }, this.options.reconnectIntervalMs);
  }

  // OBS Core Commands
  async getVersion() {
    return await this.obs.call('GetVersion');
  }

  async getStats() {
    return await this.obs.call('GetStats');
  }

  // Scene Operations
  async getSceneList() {
    return await this.obs.call('GetSceneList');
  }

  async getStationSnapshot() {
    const [sceneList, stream, record, studio, inputs, transitions, activeTransition] = await Promise.all([
      this.getSceneList(), this.getStreamStatus(), this.getRecordStatus(),
      this.obs.call('GetStudioModeEnabled'), this.getInputList(),
      this.getSceneTransitionList(), this.obs.call('GetCurrentSceneTransition')
    ]);
    const [scenes, audioInputs] = await Promise.all([
      Promise.all(sceneList.scenes.map(async ({ sceneName }) => {
        const { sceneItems } = await this.getSceneItemList(sceneName);
        return { name: sceneName, sources: sceneItems };
      })),
      Promise.all(inputs.inputs.map(async ({ inputName }) => {
        try {
          const [volume, mute] = await Promise.all([this.getInputVolume(inputName), this.getInputMute(inputName)]);
          return { name: inputName, volumeMul: volume.inputVolumeMul, volumeDb: volume.inputVolumeDb, muted: mute, ...this.audioLevels.get(inputName) };
        } catch (error) {
          if (error.code === 604 || error.code === 606) return null;
          throw error;
        }
      }))
    ]);
    return {
      scenes, audioInputs: audioInputs.filter(Boolean),
      currentProgramScene: sceneList.currentProgramSceneName,
      currentPreviewScene: sceneList.currentPreviewSceneName,
      studioModeEnabled: studio.studioModeEnabled,
      transitions: transitions.transitions.map(({ transitionName }) => transitionName),
      transitionName: activeTransition.transitionName,
      transitionDuration: activeTransition.transitionDuration,
      streamStatus: stream.outputActive ? 'STREAMING' : 'STOPPED',
      recordStatus: record.outputActive ? 'RECORDING' : 'STOPPED'
    };
  }

  async getSceneScreenshot(preview = false) {
    const sourceName = await (preview ? this.getCurrentPreviewScene() : this.getCurrentProgramScene());
    return this.obs.call('GetSourceScreenshot', { sourceName, imageFormat: 'jpeg', imageWidth: 480 });
  }

  async setTBarPosition(position, release) {
    // OBS can cancel an API-driven release at full travel (obs-studio#13887).
    if (release && position === 1) return this.triggerStudioModeTransition();
    return this.obs.call('SetTBarPosition', { position, release });
  }

  async cutToScene(sceneName) {
    const [{ transitions }, current] = await Promise.all([
      this.getSceneTransitionList(), this.obs.call('GetCurrentSceneTransition')
    ]);
    const cut = transitions.find(({ transitionKind }) => transitionKind === 'cut_transition');
    if (!cut) throw new Error('OBS does not expose a Cut transition');
    if (current.transitionName === cut.transitionName) return this.setCurrentProgramScene(sceneName);
    await this.setCurrentSceneTransition(cut.transitionName);
    try {
      await this.setCurrentProgramScene(sceneName);
    } finally {
      await this.setCurrentSceneTransition(current.transitionName);
    }
  }

  async setTextInput(inputName, text) {
    const { inputKind } = await this.obs.call('GetInputSettings', { inputName });
    if (!/^text_(gdiplus|ft2_source)(?:_v\d+)?$/.test(inputKind)) throw new Error('Selected input is not an OBS text source');
    return this.obs.call('SetInputSettings', { inputName, inputSettings: { text }, overlay: true });
  }

  async cuePlayoutMedia(decks, file) {
    const program = await this.getCurrentProgramScene();
    const deck = decks.find((item) => item.sceneName !== program);
    if (!deck) throw new Error('No off-air OBS deck is available');
    const [{ sceneItems }, { inputKind }, { videoActive }] = await Promise.all([
      this.getSceneItemList(deck.sceneName),
      this.obs.call('GetInputSettings', { inputName: deck.inputName }),
      this.obs.call('GetSourceActive', { sourceName: deck.inputName })
    ]);
    if (videoActive || inputKind !== 'ffmpeg_source' ||
      !sceneItems.some((item) => item.sourceName === deck.inputName && item.sceneItemEnabled)) {
      throw new Error('The standby deck needs its own enabled OBS Media Source, off Program');
    }
    this.playoutCue = null;
    await this.obs.call('SetInputSettings', {
      inputName: deck.inputName, overlay: true,
      inputSettings: { local_file: file, is_local_file: true, looping: false, restart_on_activate: false, close_when_inactive: false }
    });
    const cue = { id: randomUUID(), ...deck };
    this.playoutCue = { ...cue, file };
    return cue;
  }

  async takePlayoutMedia({ id }) {
    const cue = this.playoutCue;
    this.playoutCue = null;
    if (cue?.id !== id) throw new Error('Standby cue expired; prepare the deck again');
    const [{ inputSettings }, { videoActive }] = await Promise.all([
      this.obs.call('GetInputSettings', { inputName: cue.inputName }),
      this.obs.call('GetSourceActive', { sourceName: cue.inputName })
    ]);
    if (videoActive || inputSettings.local_file !== cue.file) throw new Error('Standby deck changed before take');
    await this.obs.call('TriggerMediaInputAction', {
      inputName: cue.inputName, mediaAction: 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART'
    });
    for (let attempt = 0; attempt < 12; attempt++) {
      const status = await this.obs.call('GetMediaInputStatus', { inputName: cue.inputName });
      if (status.mediaState === 'OBS_MEDIA_STATE_PLAYING') {
        await this.takePlayoutScene(cue.sceneName);
        const confirmed = await this.obs.call('GetMediaInputStatus', { inputName: cue.inputName }).catch(() => status);
        return { sceneName: cue.sceneName, inputName: cue.inputName, cursorMs: Math.max(0, confirmed.mediaCursor || 0) };
      }
      await delay(75);
    }
    throw new Error('OBS could not start the standby media source');
  }

  async takePlayoutScene(sceneName) {
    if (await this.getCurrentProgramScene() !== sceneName) await this.cutToScene(sceneName);
    for (let attempt = 0; attempt < 15; attempt++) {
      if (await this.getCurrentProgramScene() === sceneName) return { sceneName };
      await delay(40);
    }
    throw new Error('OBS did not confirm the requested Program scene');
  }

  async getPlayoutStatus(inputName) {
    const sceneName = await this.getCurrentProgramScene();
    const status = inputName ? await this.obs.call('GetMediaInputStatus', { inputName }) : {};
    return { sceneName, mediaState: status.mediaState, cursorMs: status.mediaCursor, durationMs: status.mediaDuration };
  }

  async applyPlayoutGraphics({ sceneName, overlays, nowNext }) {
    if (await this.getCurrentProgramScene() !== sceneName) return { warnings: [] };
    const items = (await this.getSceneItemList(sceneName)).sceneItems;
    const warnings = [];
    for (const { source, enabled, text } of overlays) {
      const item = items.find((value) => value.sourceName === source);
      if (!item) {
        warnings.push(`OBS source is absent from Program: ${source}`);
        continue;
      }
      if (text && nowNext) await this.setTextInput(source, nowNext);
      if (item.sceneItemEnabled !== enabled) await this.setSceneItemEnabled(sceneName, item.sceneItemId, enabled);
    }
    return { warnings };
  }

  async getCurrentProgramScene() {
    const res = await this.obs.call('GetCurrentProgramScene');
    return res.currentProgramSceneName;
  }

  async setCurrentProgramScene(sceneName) {
    return await this.obs.call('SetCurrentProgramScene', { sceneName });
  }

  async getCurrentPreviewScene() {
    const res = await this.obs.call('GetCurrentPreviewScene');
    return res.currentPreviewSceneName;
  }

  async setCurrentPreviewScene(sceneName) {
    return await this.obs.call('SetCurrentPreviewScene', { sceneName });
  }

  // Source & Scene Item Operations
  async getInputList(inputKind = null) {
    return await this.obs.call('GetInputList', inputKind ? { inputKind } : {});
  }

  async getSceneItemList(sceneName) {
    return await this.obs.call('GetSceneItemList', { sceneName });
  }

  async setSceneItemEnabled(sceneName, sceneItemId, sceneItemEnabled) {
    return await this.obs.call('SetSceneItemEnabled', {
      sceneName,
      sceneItemId,
      sceneItemEnabled
    });
  }

  // Audio Operations
  async getInputVolume(inputName) {
    return await this.obs.call('GetInputVolume', { inputName });
  }

  async setInputVolume(inputName, volumeMul, volumeDb) {
    const params = { inputName };
    if (typeof volumeMul === 'number') params.inputVolumeMul = volumeMul;
    if (typeof volumeDb === 'number') params.inputVolumeDb = volumeDb;
    return await this.obs.call('SetInputVolume', params);
  }

  async getInputMute(inputName) {
    const res = await this.obs.call('GetInputMute', { inputName });
    return res.inputMuted;
  }

  async setInputMute(inputName, inputMuted) {
    return await this.obs.call('SetInputMute', { inputName, inputMuted });
  }

  // Streaming Operations
  async getStreamStatus() {
    return await this.obs.call('GetStreamStatus');
  }

  async startStream() {
    await this.obs.call('StartStream');
    return this.confirmOutput(() => this.getStreamStatus(), true);
  }

  async stopStream() {
    await this.obs.call('StopStream');
    return this.confirmOutput(() => this.getStreamStatus(), false);
  }

  // Recording Operations
  async getRecordStatus() {
    return await this.obs.call('GetRecordStatus');
  }

  async startRecord() {
    await this.obs.call('StartRecord');
    return this.confirmOutput(() => this.getRecordStatus(), true);
  }

  async stopRecord() {
    await this.obs.call('StopRecord');
    return this.confirmOutput(() => this.getRecordStatus(), false);
  }

  async confirmOutput(getStatus, expected) {
    for (let attempt = 0; attempt < 12; attempt++) {
      const status = await getStatus();
      if (status.outputActive === expected) return status;
      await delay(250);
    }
    throw new Error('OBS accepted the request but did not confirm the output state. Check the station before retrying.');
  }

  // Studio Mode & Transitions
  async enableStudioMode() {
    return await this.obs.call('SetStudioModeEnabled', { studioModeEnabled: true });
  }

  async disableStudioMode() {
    return await this.obs.call('SetStudioModeEnabled', { studioModeEnabled: false });
  }

  async triggerStudioModeTransition() {
    return await this.obs.call('TriggerStudioModeTransition');
  }

  async getSceneTransitionList() {
    return await this.obs.call('GetSceneTransitionList');
  }

  async setCurrentSceneTransition(transitionName) {
    return await this.obs.call('SetCurrentSceneTransition', { transitionName });
  }

  async setCurrentSceneTransitionDuration(transitionDuration) {
    return await this.obs.call('SetCurrentSceneTransitionDuration', { transitionDuration });
  }
}
