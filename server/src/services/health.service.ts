import { APP_NAME, APP_VERSION } from '@/config/app-info';
import {
  getDatabaseState,
  isDatabaseConnected,
  pingDatabase,
  type DatabaseState,
} from '@/config/db';
import { env } from '@/config/env';

export interface HealthReport {
  status: 'ok';
  service: string;
  version: string;
  environment: string;
  uptimeSeconds: number;
  timestamp: string;
  database: { state: DatabaseState; connected: boolean };
}

export interface ReadinessReport {
  ready: boolean;
  checks: {
    database: { ok: boolean; state: DatabaseState };
  };
}

/**
 * Liveness: proves the process is up and answering. Deliberately never fails on a
 * database outage, so a platform health check does not kill a recoverable process.
 */
export function getHealthReport(): HealthReport {
  return {
    status: 'ok',
    service: APP_NAME,
    version: APP_VERSION,
    environment: env.NODE_ENV,
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    database: { state: getDatabaseState(), connected: isDatabaseConnected() },
  };
}

/** Readiness: proves the process can actually serve traffic that touches MongoDB. */
export async function getReadinessReport(): Promise<ReadinessReport> {
  const state = getDatabaseState();
  const ok = isDatabaseConnected() ? await pingDatabase() : false;

  return { ready: ok, checks: { database: { ok, state } } };
}
