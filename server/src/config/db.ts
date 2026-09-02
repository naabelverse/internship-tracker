import mongoose from 'mongoose';
import { env } from '@/config/env';
import { logger } from '@/config/logger';

const MAX_ATTEMPTS = 8;
const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 15_000;

export type DatabaseState =
  'disconnected' | 'connected' | 'connecting' | 'disconnecting' | 'unknown';

/** Human-readable names for `mongoose.connection.readyState` numeric codes. */
const READY_STATES: Record<number, DatabaseState> = {
  0: 'disconnected',
  1: 'connected',
  2: 'connecting',
  3: 'disconnecting',
};

mongoose.set('strictQuery', true);

let listenersBound = false;

/** Attaches connection lifecycle logging exactly once per process. */
function bindConnectionListeners(): void {
  if (listenersBound) return;
  listenersBound = true;

  mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));
  mongoose.connection.on('reconnected', () => logger.info('MongoDB reconnected'));
  mongoose.connection.on('error', (error: Error) =>
    logger.error('MongoDB connection error', { message: error.message }),
  );
}

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export function getDatabaseState(): DatabaseState {
  return READY_STATES[mongoose.connection.readyState] ?? 'unknown';
}

export function isDatabaseConnected(): boolean {
  return mongoose.connection.readyState === 1;
}

/**
 * Connects to MongoDB, retrying with exponential backoff. Rejects once the
 * attempt budget is exhausted so the caller can decide to shut down.
 */
export async function connectDatabase(
  uri: string = env.MONGO_URI,
  maxAttempts: number = MAX_ATTEMPTS,
): Promise<typeof mongoose> {
  bindConnectionListeners();

  let lastError: Error = new Error('MongoDB connection was never attempted');

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const connection = await mongoose.connect(uri, {
        serverSelectionTimeoutMS: 8_000,
        maxPoolSize: 20,
        minPoolSize: 2,
        socketTimeoutMS: 45_000,
      });
      logger.info('MongoDB connected', { database: connection.connection.name, attempt });
      return connection;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const delay = Math.min(BASE_DELAY_MS * 2 ** (attempt - 1), MAX_DELAY_MS);
      logger.warn('MongoDB connection attempt failed', {
        attempt,
        maxAttempts,
        retryInMs: attempt < maxAttempts ? delay : 0,
        message: lastError.message,
      });
      if (attempt < maxAttempts) await wait(delay);
    }
  }

  throw new Error(
    `Could not connect to MongoDB after ${maxAttempts} attempts: ${lastError.message}`,
  );
}

export async function disconnectDatabase(): Promise<void> {
  if (mongoose.connection.readyState === 0) return;
  await mongoose.disconnect();
  logger.info('MongoDB connection closed');
}

/**
 * Real connectivity check for the readiness probe: `readyState` only reports what
 * the driver last saw, so an actual round trip is what proves Mongo is reachable.
 */
export async function pingDatabase(): Promise<boolean> {
  const db = mongoose.connection.db;
  if (!db) return false;

  try {
    await db.admin().ping();
    return true;
  } catch (error) {
    logger.warn('MongoDB ping failed', {
      message: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
