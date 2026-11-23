import { Server } from 'socket.io';
import cookieParser from 'cookie-parser';
import { CryptoService } from '../security/crypto-service.js';
import { agentGateway } from '../agent/agent-gateway.js';
import { ROLE_PERMISSIONS, SOCKET_EVENTS } from '@mcr/shared';
import { RepositoryFactory } from '../repositories/repository-factory.js';
import { playoutEvents, stationPlayout } from '../playout/engine.js';
import { env } from '../../config/env.js';
import { sessionEvents, sessionUser } from '../security/session-service.js';

export function setupSocketGateway(httpServer, corsOrigin) {
  const io = new Server(httpServer, {
    allowRequest(request, done) {
      const origin = request.headers.origin;
      let allowed = !origin;
      if (origin && URL.canParse(origin)) {
        const url = new URL(origin);
        const configured = URL.canParse(corsOrigin) ? new URL(corsOrigin).origin : corsOrigin;
        allowed = url.origin === configured ||
          (env.NODE_ENV !== 'production' && ['http:', 'https:'].includes(url.protocol) && url.host === request.headers.host);
      }
      done(null, allowed);
    },
    cors: {
      origin: corsOrigin,
      credentials: true
    }
  });
  io.engine.use(cookieParser());

  // Socket.IO Authentication Middleware
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.replace('Bearer ', '') ||
      socket.request.cookies?.mcr_access_token;
    if (!token) {
      return next(new Error('Authentication required'));
    }

    try {
      const decoded = CryptoService.verifyAccessToken(token);
      const user = sessionUser(decoded);
      if (!user) return next(new Error('Authentication failed for WebSocket'));
      socket.user = user;
      socket.session = decoded;
      next();
    } catch (err) {
      next(new Error('Authentication failed for WebSocket'));
    }
  });

  io.on('connection', (socket) => {
    const orgRoom = `org:${socket.user.organizationId}`;
    socket.join(orgRoom);

    const applicable = ROLE_PERMISSIONS[socket.user.role] || [];
    const canRead = applicable.includes('*') || applicable.includes('station:read');
    let subscription = 0;
    let subscribedRoom;
    const expiry = setTimeout(() => socket.disconnect(true), Math.max(0, socket.session.exp * 1000 - Date.now()));
    expiry.unref();
    socket.on('playout:subscribe', async (stationId, ack) => {
      if (typeof ack !== 'function') return;
      if (!isCurrent(socket)) return ack({ error: 'Access denied' });
      if (!canRead || typeof stationId !== 'string' || stationId.length > 100) return ack({ error: 'Access denied' });
      const version = ++subscription;
      try {
        const station = await RepositoryFactory.getStationRepository().findById(stationId, socket.user.organizationId);
        if (version !== subscription || !socket.connected || !isCurrent(socket)) return;
        if (!station) return ack({ error: 'Station not found' });
        if (subscribedRoom) await socket.leave(subscribedRoom);
        subscribedRoom = 'playout:' + station.id;
        await socket.join(subscribedRoom);
        ack({ data: stationPlayout(station.id).snapshot() });
      } catch {
        ack({ error: 'Playout subscription failed' });
      }
    });
    socket.on('playout:unsubscribe', () => {
      subscription++;
      if (subscribedRoom) void socket.leave(subscribedRoom);
      subscribedRoom = undefined;
    });
    socket.on('disconnect', () => { clearTimeout(expiry); subscription++; });
  });

  function isCurrent(socket) {
    try {
      const user = sessionUser(socket.session);
      if (user && user.role === socket.user.role && user.organizationId === socket.user.organizationId) return true;
    } catch { /* Fail closed if session storage is unavailable. */ }
    socket.disconnect(true);
    return false;
  }

  function emitToRoom(room, event, data) {
    for (const id of io.sockets.adapter.rooms.get(room) ?? []) {
      const socket = io.sockets.sockets.get(id);
      if (socket && isCurrent(socket)) socket.emit(event, data);
    }
  }

  sessionEvents.on('revoked', (id) => {
    for (const socket of io.sockets.sockets.values()) {
      if (socket.session.sid === id) socket.disconnect(true);
    }
  });
  playoutEvents.on('state', (snapshot) => emitToRoom('playout:' + snapshot.stationId, 'playout:state', snapshot));

  // Forward Agent Gateway events to connected Web dashboard rooms
  const roomFor = (stationId, metadata) => {
    const organizationId = (metadata || agentGateway.connectedAgents.get(stationId)?.metadata)?.organizationId;
    return organizationId ? `org:${organizationId}` : null;
  };

  agentGateway.on('agentConnected', ({ stationId, metadata }) => {
    emitToRoom(roomFor(stationId, metadata), SOCKET_EVENTS.AGENT_CONNECTED, { stationId });
  });

  agentGateway.on('agentDisconnected', ({ stationId, metadata }) => {
    emitToRoom(roomFor(stationId, metadata), SOCKET_EVENTS.AGENT_DISCONNECTED, { stationId });
  });

  agentGateway.on('telemetry', ({ stationId, data }) => {
    emitToRoom(roomFor(stationId), SOCKET_EVENTS.STATION_TELEMETRY, { stationId, data });
  });

  agentGateway.on('obsEvent', ({ stationId, event, data }) => {
    emitToRoom(roomFor(stationId), `obs:${event}`, { stationId, data });
  });

  return io;
}
