import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import { SOCKET_EVENTS } from '@mcr/shared';

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
      pendingCommands: new Map() // correlationId -> { resolve, reject, timer }
    };

    this.connectedAgents.set(stationId, agentRecord);
    this.emit('agentConnected', { stationId, metadata });

    socket.on('message', (raw) => {
      if (this.connectedAgents.get(stationId) !== agentRecord) return;
      try {
        const msg = JSON.parse(raw.toString());
        this._handleAgentMessage(stationId, msg);
      } catch (err) {
        console.error(`[AgentGateway] Error parsing message from agent ${stationId}:`, err);
      }
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

  disconnectDeletedStation(stationId) {
    const agent = this.connectedAgents.get(stationId);
    if (!agent) return;
    this._cleanupAgent(stationId, agent);
    agent.socket.close(4004, 'Station deleted');
  }

  /**
   * Dispatches an authorized command to the agent and awaits acknowledgment
   */
  async sendCommand(stationId, command, params = {}, timeoutMs = 5000) {
    const agent = this.connectedAgents.get(stationId);
    if (!agent || agent.socket.readyState !== 1) { // 1 = OPEN
      throw Object.assign(new Error('Station agent is offline or disconnected'), { statusCode: 503 });
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
        pending.reject(Object.assign(new Error(msg.error || 'Agent command execution failed'), { statusCode: 502 }));
      }
      return;
    }

    // Telemetry and Real-Time Event Sync
    if (msg.type === 'TELEMETRY') {
      const agent = this.connectedAgents.get(stationId);
      if (!agent) return;
      agent.telemetry = msg.data;
      agent.lastHeartbeat = new Date().toISOString();
      this.emit('telemetry', { stationId, data: msg.data });
      return;
    }

    if (msg.type === 'OBS_EVENT') {
      this.emit('obsEvent', { stationId, event: msg.event, data: msg.data });
      return;
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
