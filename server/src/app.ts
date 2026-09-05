import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express, type RequestHandler } from 'express';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import { env } from '@/config/env';
import { openApiDocument } from '@/docs/openapi';
import { errorHandler } from '@/middleware/errorHandler';
import { httpLogger } from '@/middleware/httpLogger';
import { notFound } from '@/middleware/notFound';
import { globalRateLimiter } from '@/middleware/rateLimit';
import { requestId } from '@/middleware/requestId';
import { attachSentryErrorHandler } from '@/config/sentry';
import apiRouter from '@/routes/index';
import healthRouter from '@/routes/health.routes';

const BODY_LIMIT = '1mb';

/**
 * Swagger UI needs inline script and style, which the global helmet policy
 * forbids. Scoped to the docs path so nothing else is relaxed.
 */
const docsContentSecurityPolicy: RequestHandler = (_request, response, next) => {
  response.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:",
  );
  next();
};

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

  app.use(
    '/api/docs',
    docsContentSecurityPolicy,
    swaggerUi.serve,
    swaggerUi.setup(openApiDocument, { customSiteTitle: 'Internship Tracker API' }),
  );

  app.get('/api/docs.json', (_request, response) => {
    response.json(openApiDocument);
  });

  // Probes live at the root so platform health checks do not need the API version.
  app.use(healthRouter);
  app.use('/api/v1', apiRouter);

  app.use(notFound);
  // Reports the failure with the request still in scope, then falls through to
  // the handler below, which is what actually answers the client. A no-op unless
  // SENTRY_DSN is set.
  attachSentryErrorHandler(app);
  app.use(errorHandler);

  return app;
}
