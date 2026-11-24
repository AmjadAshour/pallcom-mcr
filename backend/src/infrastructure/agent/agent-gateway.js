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
        pending.resolve(msg.result);
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
