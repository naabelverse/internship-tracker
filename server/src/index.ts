import type { Server } from 'node:http';
import { createApp } from '@/app';
import { connectDatabase, disconnectDatabase } from '@/config/db';
import { env } from '@/config/env';
import { logger } from '@/config/logger';
import { startScheduledJobs, stopScheduledJobs } from '@/jobs';

const SHUTDOWN_TIMEOUT_MS = 10_000;

const app = createApp();

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
