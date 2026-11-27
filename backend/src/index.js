import { startAutomationWorker } from './presentation/controllers/automation.controller.js';
import express from 'express';
import http from 'node:http';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import pino from 'pino';
import { fileURLToPath } from 'node:url';

import { env, isExposedBootstrapPassword } from './config/env.js';
import { inboundHttpOptions } from './config/http-server.js';
import { apiRouter } from './presentation/routes/index.js';
import { graphicsRouter } from './presentation/routes/graphics.js';
import { watermarkRouter } from './presentation/routes/watermark.js';
import { tickerRouter } from './presentation/routes/ticker.js';
import { adsRouter } from './presentation/routes/ads.js';
import { scenesRouter } from './presentation/routes/scenes.js';
import { playoutRouter } from './presentation/routes/playout.js';
import { attachPlayout, restorePlayout } from './infrastructure/playout/engine.js';
import { requireMutationOrigin } from './presentation/middlewares/mutation-origin.middleware.js';
import { errorHandler } from './presentation/middlewares/error.middleware.js';
import { apiLimiter } from './presentation/middlewares/rate-limiter.middleware.js';
import { setupSocketGateway } from './infrastructure/realtime/socket-gateway.js';
import { setupAgentWsServer } from './infrastructure/agent/agent-ws-server.js';
import { RepositoryFactory } from './infrastructure/repositories/repository-factory.js';
import { CryptoService } from './infrastructure/security/crypto-service.js';
import { forwardProgram, programRuntimePort } from './infrastructure/program/runtime-proxy.js';
import { startProgramSchedule } from './infrastructure/program/schedule.js';

const logger = pino({ level: env.LOG_LEVEL });
const app = express();
app.set('trust proxy', env.TRUST_PROXY);
const server = http.createServer(inboundHttpOptions, app);

// 1. Security Headers (Helmet)
app.use(helmet({
  contentSecurityPolicy: env.NODE_ENV === 'production' ? {
    directives: {
      connectSrc: ["'self'", `wss://${new URL(env.CORS_ORIGIN).host}`],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      mediaSrc: ["'self'"],
      styleSrc: ["'self'", 'https://fonts.googleapis.com', "'unsafe-inline'"]
    }
  } : false,
  crossOriginEmbedderPolicy: false
}));

// 2. Strict CORS Configuration
app.use(cors({
  origin: [env.CORS_ORIGIN],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

app.use('/api', requireMutationOrigin);

// 4. Rate Limiting on API endpoints
app.use('/api', apiLimiter);

const runtimePort = programRuntimePort(process.env.MCR_PROGRAM_RUNTIME_PORT);
if (runtimePort) {
  if (runtimePort === env.PORT || env.STORAGE_MODE !== 'sqlite') {
    throw new Error('Separate Program runtime requires its own port and SQLite storage');
  }
  app.use(forwardProgram(runtimePort));
}
app.use('/api/v1/stations/:id/graphics', express.json({ limit: '800kb' }));
app.use('/api/v1/stations/:id/program/watermark', express.json({ limit: '800kb' }));
app.use('/api/v1/stations/:id/playout', express.json({ limit: '512kb' }));
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));
app.use(cookieParser());

// 5. API Health Check
app.get('/health', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({
    status: 'ok',
    app: env.APP_NAME,
    mode: env.STORAGE_MODE,
    revision: env.DEPLOYMENT_REVISION,
    sqlitePersistence: env.SQLITE_PERSISTENCE,
    timestamp: new Date().toISOString()
  });
});

// 6. Mount Versioned REST API
app.use('/api/v1', apiRouter);
app.use('/api/v1', graphicsRouter);
app.use('/api/v1', watermarkRouter);
app.use('/api/v1', tickerRouter);
app.use('/api/v1', adsRouter);
app.use('/api/v1', scenesRouter);
app.use('/api/v1', playoutRouter);
const webRoot = fileURLToPath(new URL('../../frontend/dist/', import.meta.url));
app.use(express.static(webRoot));
app.get(/^\/(?!api(?:\/|$)|socket\.io(?:\/|$)).*/, (req, res, next) => {
  res.sendFile('index.html', { root: webRoot }, (error) => { if (error) next(error); });
});

// 7. Global Error Handler
app.use(errorHandler);

// 8. Setup Real-time Gateways
setupSocketGateway(server, env.CORS_ORIGIN);
setupAgentWsServer(server);
attachPlayout();

// Ensure default Admin user exists in database on startup
async function initDefaultData() {
  try {
    const userRepo = RepositoryFactory.getUserRepository();
    const existingAdmin = await userRepo.findByEmail('admin@mcrpro.local');
    const bootstrapPassword = process.env.MCR_ADMIN_PASSWORD;
    const previousPassword = process.env.MCR_PREVIOUS_ADMIN_PASSWORD;
    if (!existingAdmin && bootstrapPassword?.length >= 12) {
      const passwordHash = await CryptoService.hashPassword(bootstrapPassword);
      await userRepo.create({
        email: 'admin@mcrpro.local',
        passwordHash,
        fullName: 'System Super Administrator',
        role: 'SUPER_ADMIN',
        organizationId: 'default-org',
        isActive: true
      });
      logger.info('Bootstrap administrator initialized');
    } else if (existingAdmin && bootstrapPassword?.length >= 12 &&
      isExposedBootstrapPassword(previousPassword) &&
      await CryptoService.verifyPassword(existingAdmin.passwordHash, previousPassword)) {
      await userRepo.update(existingAdmin.id, { passwordHash: await CryptoService.hashPassword(bootstrapPassword) });
      logger.info('Legacy administrator password rotated');
    } else if (!existingAdmin) {
      logger.warn('Set MCR_ADMIN_PASSWORD to at least 12 characters to initialize the administrator');
    }

  } catch (err) {
    logger.error({ err }, 'Error during initial data check');
  }
}

// Start Server
if (process.env.NODE_ENV !== 'test') {
  server.listen(env.PORT, process.env.MCR_BIND_HOST || '127.0.0.1', async () => {
    logger.info(`[${env.APP_NAME}] Backend running on port ${env.PORT} in ${env.NODE_ENV} mode [Storage: ${env.STORAGE_MODE}]`);
    await initDefaultData();
    if (!server.listening) return;
    server.once('close', startAutomationWorker());
    restorePlayout();
    if (!runtimePort && env.STORAGE_MODE === 'sqlite' && server.listening) {
      const scheduleTimer = startProgramSchedule();
      server.once('close', () => clearInterval(scheduleTimer));
    }
  });
}

export { app, server };


