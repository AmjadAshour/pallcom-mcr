import { WebSocketServer } from 'ws';
import { agentGateway, HEARTBEAT_INTERVAL_MS } from './agent-gateway.js';
import { RepositoryFactory } from '../repositories/repository-factory.js';
import { CryptoService } from '../security/crypto-service.js';
import { currentAgentGeneration } from './agent-credentials.js';

export function setupAgentWsServer(httpServer) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 * 1024 });
  const heartbeat = setInterval(() => agentGateway.sweepConnections(), HEARTBEAT_INTERVAL_MS);
  heartbeat.unref();
  httpServer.once('close', () => clearInterval(heartbeat));

  httpServer.on('upgrade', (request, socket, head) => {
    const url = URL.parse(request.url, 'http://localhost');
    if (url?.pathname === '/agent-ws') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    }
  });

  wss.on('connection', async (ws, req) => {
    ws.on('error', () => ws.terminate());
    const url = new URL(req.url, 'http://localhost');
    const stationId = url.searchParams.get('stationId') || req.headers['x-station-id'];
    const agentToken = req.headers['x-agent-token'];

    if (!stationId) {
      ws.close(4001, 'Missing station identifier');
      return;
    }

    try {
      let identity;
      try {
        identity = CryptoService.verifyAgentToken(agentToken);
      } catch {
        ws.close(4003, 'Invalid agent credentials');
        return;
      }
      if (identity.sub !== stationId) {
        ws.close(4003, 'Station does not match agent credentials');
        return;
      }
      const stationRepo = RepositoryFactory.getStationRepository();
      const station = await stationRepo.findById(stationId, identity.organizationId);

      if (!station) {
        ws.close(4004, 'Station not registered');
        return;
      }
      if (ws.readyState !== 1) return;
      const generation = currentAgentGeneration(stationId, identity.organizationId);
      if (generation === null || generation !== (identity.generation ?? 0)) {
        ws.close(4003, 'Agent credentials revoked');
        return;
      }

      agentGateway.registerAgent(stationId, ws, {
        stationId,
        organizationId: identity.organizationId,
        expiresAt: identity.exp * 1000,
        ipAddress: req.socket.remoteAddress
      });

      // Update station online status
      await stationRepo.updateStatus(stationId, {
        status: 'DEGRADED',
        lastHeartbeat: new Date().toISOString()
      });

      ws.send(JSON.stringify({ type: 'HANDSHAKE_ACK', stationId }));
    } catch (err) {
      console.error('[AgentWsServer] Connection setup error:', err);
      ws.close(4500, 'Internal server error during handshake');
    }
  });

  return wss;
}
