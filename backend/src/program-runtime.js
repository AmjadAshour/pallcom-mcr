import express from 'express';
import cookieParser from 'cookie-parser';
import { env } from './config/env.js';
import { apiRouter } from './presentation/routes/index.js';
import { adsRouter } from './presentation/routes/ads.js';
import { scenesRouter } from './presentation/routes/scenes.js';
import { watermarkRouter } from './presentation/routes/watermark.js';
import { tickerRouter } from './presentation/routes/ticker.js';
import { errorHandler } from './presentation/middlewares/error.middleware.js';
import { programPath, programRuntimePort } from './infrastructure/program/runtime-proxy.js';
import { getSqliteDatabase } from './infrastructure/database/sqlite.js';
import { setSourceRecovery, startConfiguredProgram } from './infrastructure/program/supervisor.js';
import { restoreProgramSource } from './infrastructure/program/resume-source.js';
import { startProgramSchedule } from './infrastructure/program/schedule.js';

const port = programRuntimePort(process.env.MCR_PROGRAM_RUNTIME_PORT);
if (!port || !process.env.MCR_PROGRAM_STATION_ID || env.STORAGE_MODE !== 'sqlite') {
  throw new Error('Program runtime requires its port, station ID and SQLite storage');
}

const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {
  if (!programPath.test(req.path)) return res.sendStatus(404);
  const origin = req.get('Origin');
  if (origin && origin !== env.CORS_ORIGIN) return res.sendStatus(403);
  next();
});
app.use('/api/v1/stations/:id/program/watermark', express.json({ limit:'800kb' }));
app.use(express.json({ limit:'100kb' }));
app.use(cookieParser());
app.use('/api/v1', apiRouter, watermarkRouter, adsRouter, scenesRouter, tickerRouter);
app.use(errorHandler);
app.listen(port, '127.0.0.1', async () => {
  console.log('Program runtime listening on loopback');
  startProgramSchedule(process.env.MCR_PROGRAM_STATION_ID);
  if (process.env.MCR_PROGRAM_AUTOSTART !== '1') return;
  try {
    const id = process.env.MCR_PROGRAM_STATION_ID;
    if (!getSqliteDatabase().prepare('SELECT 1 FROM stations WHERE id=?').get(id)) {
      console.error('Program auto-start skipped because the configured station does not exist');
      return;
    }
    const { session } = await startConfiguredProgram(id);
    if (process.env.MCR_PROGRAM_RESTORE_SOURCE === '1') {
      setSourceRecovery(session, 'waiting');
      const result = await restoreProgramSource(id, session).catch(() => {
        console.error('Saved Program source could not be restored. Check Live Control.');
        return 'unavailable';
      });
      setSourceRecovery(session, result);
    }
  } catch {
    console.error('Program auto-start failed. Verify the runtime configuration and start Program from Live Control.');
  }
});
