import cookieParser from 'cookie-parser';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { env } from './config/env';
import { prisma } from './db';
import { errorHandler, notFound } from './middleware/errors';
import { authRouter } from './routes/auth';
import { eventRouter } from './routes/event';
import { publicRouter } from './routes/public';
import { ticketsRouter } from './routes/tickets';
import { uploadsRouter } from './routes/uploads';

export function createApp(): Express {
  const app = express();
  app.disable('x-powered-by');
  // Needed for correct client IPs (rate limiting) behind the Next.js proxy / load balancer.
  app.set('trust proxy', env.TRUST_PROXY);

  app.use(helmet());
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.get('/api/health', async (_req, res) => {
    let db = true;
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      db = false;
    }
    res.status(db ? 200 : 503).json({ ok: db, db });
  });

  app.use('/api/auth', authRouter());
  app.use('/api/event', eventRouter());
  app.use('/api/uploads', uploadsRouter());
  app.use('/api/tickets', ticketsRouter());
  app.use('/api/public', publicRouter());

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
