import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { logger } from './logger.js';
import authRoutes from './routes/auth.js';
import meRoutes from './routes/me.js';
import whatsappRoutes from './routes/whatsapp.js';
import recoveryRoutes from './routes/recovery.js';
import settingsRoutes from './routes/settings.js';
import adminRoutes from './routes/admin.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: false })); // API returns JSON; HSTS/nosniff/frameguard on
  app.use(express.json({ limit: '32kb' }));
  app.use(cookieParser());
  app.use(cors({ origin: config.webUrl, credentials: true }));
  app.use(rateLimit({ windowMs: 60_000, max: 300 }));

  app.get('/health', (_req, res) => res.json({ ok: true, version: process.env.APP_VERSION ?? '1.0.0' }));
  app.use('/auth', authRoutes);
  app.use('/', meRoutes);                    // GET /me, DELETE /account, /recovery-records
  app.use('/whatsapp', whatsappRoutes);      // session mgmt
  app.use('/settings', settingsRoutes);      // recovery destination
  app.use('/recovery', recoveryRoutes);
  app.use('/admin', adminRoutes);

  // Central error handler — never echo message bodies.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    logger.error({ msg: 'request_failed', err: err.message });
    res.status(500).json({ error: 'internal_error' });
  });
  return app;
}
