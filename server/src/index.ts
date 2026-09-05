import type { Server } from 'node:http';
import { createApp } from '@/app';
import { connectDatabase, disconnectDatabase } from '@/config/db';
import { env } from '@/config/env';
import { logger } from '@/config/logger';
import { flushSentry, initSentry } from '@/config/sentry';
import { startScheduledJobs, stopScheduledJobs } from '@/jobs';
import { initMailer } from '@/services/mailer.service';

const SHUTDOWN_TIMEOUT_MS = 10_000;

// Before the app is built, so an error thrown while wiring routes is still
// reported. A no-op when SENTRY_DSN is unset.
//
// Sentry's automatic HTTP instrumentation wants to load before the modules it
// patches, which a static import graph cannot guarantee; that only affects
// tracing, which is off by default here, and the deploy step to preload the SDK
// belongs with the rest of the production configuration in DEPLOYMENT.md.
// Error capture, which is what this integration is for, does not depend on it.
initSentry();

const app = createApp();

// Resolves and announces the transport now rather than on the first send, so a
// deploy that meant to configure SMTP and did not says so in the startup log
// instead of quietly printing every verification email to stdout.
initMailer();

const server: Server = app.listen(env.PORT, () => {
  logger.info('API listening', { port: env.PORT, environment: env.NODE_ENV });
});

let shuttingDown = false;

/** Closes the HTTP server first, then MongoDB, with a hard deadline as a backstop. */
async function shutdown(reason: string, exitCode = 0): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info('Shutting down', { reason });

  const forceExit = setTimeout(() => {
    logger.error('Graceful shutdown timed out, forcing exit');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  try {
    await stopScheduledJobs();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    // Before the connection closes, so the crash that caused the shutdown is
    // actually delivered rather than dropped with the buffer.
    await flushSentry();
    await disconnectDatabase();
    clearTimeout(forceExit);
    logger.info('Shutdown complete');
    process.exit(exitCode);
  } catch (error) {
    logger.error('Error during shutdown', {
      message: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  }
}

connectDatabase()
  .then(() => {
    // Started only once the database is reachable: a sweep against a dead
    // connection would just log failures every hour.
    startScheduledJobs();
  })
  .catch((error: Error) => {
    logger.error('Database unavailable, shutting down', { message: error.message });
    void shutdown('database-unavailable', 1);
  });

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', {
    message: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });
  void shutdown('unhandledRejection', 1);
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', { message: error.message, stack: error.stack });
  void shutdown('uncaughtException', 1);
});
