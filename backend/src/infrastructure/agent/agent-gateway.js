import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import { z } from 'zod';

export const HEARTBEAT_INTERVAL_MS = 5_000;
const TELEMETRY_TIMEOUT_MS = 15_000;
const MAX_PENDING_COMMANDS = 32;
const MAX_SEND_BUFFER = 1024 * 1024;
const name = z.string().min(1).max(512);
const nonnegative = z.number().nonnegative();
const telemetrySchema = z.object({
  obsConnected: z.boolean(), fps: nonnegative.max(1000).optional(),
  cpuUsage: nonnegative.max(100).optional(), memoryUsage: nonnegative.max(100).optional(),
  droppedFrames: nonnegative.int().optional(), renderTotalFrames: nonnegative.int().optional(),
  uptimeSeconds: nonnegative.optional(), hostname: name.optional(), platform: name.optional(),
  outputActive: z.boolean().optional()
});
const outputState = z.object({ active: z.boolean(), state: name });
const sceneEvent = z.object({ sceneName: name, isPreview: z.boolean().optional() });
const obsEvents = new Map(Object.entries({
  sceneChanged: sceneEvent, previewSceneChanged: sceneEvent,
  streamStateChanged: outputState, recordStateChanged: outputState,
  inputVolumeChanged: z.object({ inputName: name, volumeMul: nonnegative, volumeDb: z.number().optional() }),
  inputMuteChanged: z.object({ inputName: name, muted: z.boolean() }),
  mediaPlaybackEnded: z.object({ inputName: name })
}));

const playoutAssetSchema = z.object({
  assetId: z.string().regex(/^[a-f0-9]{16}:[\w-]{1,1600}$/),
  title: name,
  durationMs: z.number().int().min(1).max(86400000).optional(),
  width: z.number().int().min(1).max(16384).optional(),
  height: z.number().int().min(1).max(16384).optional(),
  health: z.enum(['ready', 'missing', 'unreadable'])
});

const sceneSourceSchema = z.object({
  sceneItemId: z.number().int(),
  sourceName: name,
  sceneItemEnabled: z.boolean(),
  inputKind: z.string().max(128).nullable().optional(),
  sourceType: z.string().max(128).nullable().optional(),
  sceneItemIndex: nonnegative.int().optional()
});

const audioInputSchema = z.object({
  name,
  volumeMul: nonnegative.max(20).optional(),
  volumeDb: z.number().min(-200).max(100).optional(),
  muted: z.boolean(),
  levelDb: z.number().min(-200).max(100).optional(),
  peakDb: z.number().min(-200).max(100).optional()
});

const stationSnapshotSchema = z.object({
  scenes: z.array(z.object({
    name,
    sources: z.array(sceneSourceSchema).max(200).default([])
  })).max(200).optional(),
  audioInputs: z.array(audioInputSchema).max(200).optional(),
  currentProgramScene: name.nullable().optional(),
  currentPreviewScene: name.nullable().optional(),
  studioModeEnabled: z.boolean().optional(),
  transitions: z.array(name).max(100).optional(),
  transitionName: name.nullable().optional(),
  transitionDuration: nonnegative.int().max(60000).nullable().optional(),
  streamStatus: z.enum(['STOPPED', 'STARTING', 'STREAMING', 'STOPPING']).optional(),
  streamBitrateKbps: nonnegative.int().nullable().optional(),
  streamReconnecting: z.boolean().optional(),
  replayBufferActive: z.boolean().nullable().optional(),
  lastReplaySavedAt: z.string().datetime().nullable().optional(),
  recordStatus: z.enum(['STOPPED', 'STARTING', 'RECORDING', 'PAUSED', 'STOPPING']).optional()
});

const defaultAckSchema = z.object({
  accepted: z.boolean().optional(),
  success: z.boolean().optional(),
  currentProgramScene: name.optional(),
  outputActive: z.boolean().optional()
});

const commandResults = new Map(Object.entries({
  ScanPlayoutMedia: z.object({
    assets: z.array(playoutAssetSchema).max(500),
    warnings: z.array(z.string().max(512)).max(50).default([]),
    truncated: z.boolean().default(false)
  }),
  CheckPlayoutMedia: z.array(playoutAssetSchema).max(200),
  CuePlayoutMedia: z.object({
    id: name,
    sceneName: name.optional(),
    inputName: name.optional()
  }),
  TakePlayoutMedia: z.object({
    sceneName: name,
    inputName: name.nullable().optional(),
    cursorMs: nonnegative.optional()
  }),
  TakePlayoutScene: z.object({
    sceneName: name
  }),
  GetPlayoutStatus: z.object({
    sceneName: name,
    mediaState: name.nullable().optional(),
    cursorMs: nonnegative.nullable().optional(),
    durationMs: nonnegative.nullable().optional()
  }),
  ApplyPlayoutGraphics: z.object({
    warnings: z.array(z.string().max(512)).max(50).optional()
  }),
  GetStationSnapshot: stationSnapshotSchema,
  GetSceneScreenshot: z.object({
    imageData: z.string().max(1024 * 1024).regex(/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/)
  }),
  GetSceneList: z.object({
    scenes: z.array(z.object({
      sceneName: name,
      sceneIndex: nonnegative.int().optional()
    })).max(200),
    currentProgramSceneName: name.nullable().optional(),
    currentPreviewSceneName: name.nullable().optional()
  }),
  GetStats: z.object({
    activeFps: nonnegative.optional(),
    cpuUsage: nonnegative.optional(),
    memoryUsage: nonnegative.optional(),
    outputSkippedFrames: nonnegative.int().optional(),
    renderTotalFrames: nonnegative.int().optional()
  }),
  GetVersion: z.object({
    obsVersion: name.optional(),
    obsWebSocketVersion: name.optional(),
    rpcVersion: nonnegative.int().optional(),
    platform: name.optional()
  }),
  StartReplayBuffer: defaultAckSchema,
  StopReplayBuffer: defaultAckSchema,
  SaveReplayBuffer: defaultAckSchema,
  SetSceneItemEnabled: defaultAckSchema,
  CutToScene: defaultAckSchema,
  SetTBarPosition: defaultAckSchema,
  SetTextInput: defaultAckSchema,
  SetStudioModeEnabled: defaultAckSchema,
  SetCurrentSceneTransition: defaultAckSchema,
  SetCurrentSceneTransitionDuration: defaultAckSchema,
  SetCurrentProgramScene: defaultAckSchema,
  SetCurrentPreviewScene: defaultAckSchema,
  StartStream: defaultAckSchema,
  StopStream: defaultAckSchema,
  StartRecord: defaultAckSchema,
  StopRecord: defaultAckSchema,
  SetInputVolume: defaultAckSchema,
  SetInputMute: defaultAckSchema,
  TriggerStudioModeTransition: defaultAckSchema
}));

export class AgentGateway extends EventEmitter {
  constructor() {
    super();
    // Map of stationId -> { socket, stationInfo, pendingCommands }
    this.connectedAgents = new Map();
  }

  registerAgent(stationId, socket, metadata = {}) {
    // If an agent is already connected for this station, gracefully close old connection
    if (this.connectedAgents.has(stationId)) {
      const old = this.connectedAgents.get(stationId);
      try {
        old.socket.close(1000, 'Replaced by newer connection');
      } catch {}
    }

    const agentRecord = {
      stationId,
      socket,
      metadata,
      connectedAt: new Date(),
      awaitingPong: false,
      telemetry: { obsConnected: false },
      telemetryAt: null,
      pendingCommands: new Map() // correlationId -> { resolve, reject, timer }
    };

    this.connectedAgents.set(stationId, agentRecord);
    this.emit('agentConnected', { stationId, metadata });

    socket.on('pong', () => { agentRecord.awaitingPong = false; });
    socket.on('message', (raw) => {
      if (this.connectedAgents.get(stationId) !== agentRecord) return;
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch { return; }
      if (message && typeof message === 'object' && !Array.isArray(message)) this._handleAgentMessage(stationId, message);
    });

    socket.on('close', () => {
      this._cleanupAgent(stationId, agentRecord);
    });

    socket.on('error', (err) => {
      console.error(`[AgentGateway] Agent socket error for station ${stationId}:`, err);
      this._cleanupAgent(stationId, agentRecord);
    });
  }

  isAgentOnline(stationId) {
    return this.connectedAgents.has(stationId);
  }

  stationStatus(stationId) {
    const agent = this.connectedAgents.get(stationId);
    if (!agent || agent.socket.readyState !== 1) return 'OFFLINE';
    return agent.telemetry.obsConnected ? 'ONLINE' : 'DEGRADED';
  }

  sweepConnections(now = Date.now()) {
    for (const [stationId, agent] of this.connectedAgents) {
      if (agent.metadata.expiresAt <= now) {
        this.disconnectAgent(stationId, 4003, 'Agent credentials expired');
        continue;
      }
      if (agent.awaitingPong || agent.socket.readyState !== 1) {
        this._cleanupAgent(stationId, agent);
        agent.socket.terminate();
        continue;
      }
      agent.awaitingPong = true;
      agent.socket.ping();
      if (agent.telemetryAt !== null && now - agent.telemetryAt >= TELEMETRY_TIMEOUT_MS) {
        agent.telemetryAt = null;
        agent.telemetry = { obsConnected: false };
        this.emit('telemetry', { stationId, data: agent.telemetry });
      }
    }
  }

  disconnectDeletedStation(stationId) {
    this.disconnectAgent(stationId, 4004, 'Station deleted');
  }

  disconnectAgent(stationId, code, reason) {
    const agent = this.connectedAgents.get(stationId);
    if (!agent) return;
    this._cleanupAgent(stationId, agent);
    agent.socket.close(code, reason);
  }

  /**
   * Dispatches an authorized command to the agent and awaits acknowledgment
   */
  async sendCommand(stationId, command, params = {}, timeoutMs = 5000) {
    const agent = this.connectedAgents.get(stationId);
    if (!agent || agent.socket.readyState !== 1) { // 1 = OPEN
      throw Object.assign(new Error('Station agent is offline or disconnected'), { statusCode: 503 });
    }
    if (agent.pendingCommands.size >= MAX_PENDING_COMMANDS || agent.socket.bufferedAmount > MAX_SEND_BUFFER) {
      throw Object.assign(new Error('Station agent is busy. Retry when its command backlog clears.'), { statusCode: 503 });
    }

    const correlationId = crypto.randomUUID();

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        agent.pendingCommands.delete(correlationId);
        reject(Object.assign(new Error('OBS did not confirm this command. Its outcome is unknown.'), { statusCode: 504 }));
      }, timeoutMs);

      agent.pendingCommands.set(correlationId, { resolve, reject, timer, command });

      const payload = JSON.stringify({
        type: 'EXECUTE_COMMAND',
        correlationId,
        command,
        params
      });

      agent.socket.send(payload, (error) => {
        if (!error || !agent.pendingCommands.delete(correlationId)) return;
        clearTimeout(timer);
        reject(Object.assign(new Error('Could not send the command to the station agent'), { statusCode: 503 }));
      });
    });
  }

  _handleAgentMessage(stationId, msg) {
    const agent = this.connectedAgents.get(stationId);

    // Command Response Acknowledgment
    if (msg.type === 'COMMAND_ACK' && msg.correlationId) {
      if (agent && agent.pendingCommands.has(msg.correlationId)) {
        const pending = agent.pendingCommands.get(msg.correlationId);
        clearTimeout(pending.timer);
        agent.pendingCommands.delete(msg.correlationId);
        const schema = commandResults.get(pending.command);
        const parsed = schema?.safeParse(msg.result ?? {});
        if (!parsed?.success) {
          pending.reject(Object.assign(new Error('Invalid agent command result'), { statusCode: 502 }));
          return;
        }
        pending.resolve(parsed.data);
      }
      return;
    }

    // Command Error
    if (msg.type === 'COMMAND_ERROR' && msg.correlationId) {
      if (agent && agent.pendingCommands.has(msg.correlationId)) {
        const pending = agent.pendingCommands.get(msg.correlationId);
        clearTimeout(pending.timer);
        agent.pendingCommands.delete(msg.correlationId);
        const reason = typeof msg.error === 'string' && msg.error.length <= 300 ? msg.error : 'Agent command execution failed';
        pending.reject(Object.assign(new Error(reason), { statusCode: 502 }));
      }
      return;
    }

    // Telemetry and Real-Time Event Sync
    if (msg.type === 'TELEMETRY') {
      const parsed = telemetrySchema.safeParse(msg.data);
      if (!agent || !parsed.success) return;
      agent.telemetry = parsed.data;
      agent.telemetryAt = Date.now();
      agent.lastHeartbeat = new Date(agent.telemetryAt).toISOString();
      this.emit('telemetry', { stationId, data: parsed.data });
      return;
    }

    if (msg.type === 'OBS_EVENT') {
      const parsed = obsEvents.get(msg.event)?.safeParse(msg.data);
      if (parsed?.success) this.emit('obsEvent', { stationId, event: msg.event, data: parsed.data });
    }
  }

  _cleanupAgent(stationId, agent) {
    if (agent) {
      for (const [id, pending] of agent.pendingCommands.entries()) {
        clearTimeout(pending.timer);
        pending.reject(Object.assign(new Error('Agent disconnected before OBS confirmed the command'), { statusCode: 503 }));
      }
      agent.pendingCommands.clear();
      if (this.connectedAgents.get(stationId) === agent) {
        this.connectedAgents.delete(stationId);
        this.emit('agentDisconnected', { stationId, metadata: agent.metadata });
      }
    }
  }
}

export const agentGateway = new AgentGateway();
