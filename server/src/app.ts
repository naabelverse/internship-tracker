import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { env } from '@/config/env';
import { errorHandler } from '@/middleware/errorHandler';
import { httpLogger } from '@/middleware/httpLogger';
import { notFound } from '@/middleware/notFound';
import { globalRateLimiter } from '@/middleware/rateLimit';
import { requestId } from '@/middleware/requestId';
import apiRouter from '@/routes/index';
import healthRouter from '@/routes/health.routes';

const BODY_LIMIT = '1mb';

/**
 * Builds the Express application without binding a port, so tests can drive it
 * with supertest and the bootstrap in `index.ts` owns the process lifecycle.
 */
export function createApp(): Express {
  const app = express();

  app.set('trust proxy', env.TRUST_PROXY);
  app.disable('x-powered-by');

  app.use(requestId);
  app.use(helmet());
  app.use(cors({ origin: env.CLIENT_ORIGIN, credentials: true }));
  app.use(compression());
  app.use(express.json({ limit: BODY_LIMIT }));
  app.use(express.urlencoded({ extended: true, limit: BODY_LIMIT }));
  app.use(cookieParser());
  app.use(httpLogger);
  app.use(globalRateLimiter);

  // Probes live at the root so platform health checks do not need the API version.
  app.use(healthRouter);
  app.use('/api/v1', apiRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
