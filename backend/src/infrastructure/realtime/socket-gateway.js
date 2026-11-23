import { Server } from 'socket.io';
import { CryptoService } from '../security/crypto-service.js';
import { agentGateway } from '../agent/agent-gateway.js';
import { SOCKET_EVENTS } from '@mcr/shared';

export function setupSocketGateway(httpServer, corsOrigin) {
  const io = new Server(httpServer, {
    cors: {
      origin: corsOrigin,
      credentials: true
    }
  });

  // Socket.IO Authentication Middleware
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.replace('Bearer ', '');
    if (!token) {
      return next(new Error('Authentication required'));
    }

    try {
      const decoded = CryptoService.verifyAccessToken(token);
      socket.user = {
        id: decoded.sub,
        email: decoded.email,
        organizationId: decoded.organizationId || 'default-org',
        role: decoded.role || 'VIEWER'
      };
      next();
    } catch (err) {
      next(new Error('Authentication failed for WebSocket'));
    }
  });

  io.on('connection', (socket) => {
    const orgRoom = `org:${socket.user.organizationId}`;
    socket.join(orgRoom);

    socket.on('disconnect', () => {});
  });

  // Forward Agent Gateway events to connected Web dashboard rooms
  const roomFor = (stationId, metadata) => {
    const organizationId = (metadata || agentGateway.connectedAgents.get(stationId)?.metadata)?.organizationId;
    return organizationId ? io.to(`org:${organizationId}`) : null;
  };

  agentGateway.on('agentConnected', ({ stationId, metadata }) => {
    roomFor(stationId, metadata)?.emit(SOCKET_EVENTS.AGENT_CONNECTED, { stationId });
  });

  agentGateway.on('agentDisconnected', ({ stationId, metadata }) => {
    roomFor(stationId, metadata)?.emit(SOCKET_EVENTS.AGENT_DISCONNECTED, { stationId });
  });

  agentGateway.on('telemetry', ({ stationId, data }) => {
    roomFor(stationId)?.emit(SOCKET_EVENTS.STATION_TELEMETRY, { stationId, data });
  });

  agentGateway.on('obsEvent', ({ stationId, event, data }) => {
    roomFor(stationId)?.emit(`obs:${event}`, { stationId, data });
  });

  return io;
}
