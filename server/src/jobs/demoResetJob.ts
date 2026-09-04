import cron, { type ScheduledTask } from 'node-cron';
import { env } from '@/config/env';
import { logger } from '@/config/logger';
import { User } from '@/models/User';
import { seedDemoAccount, type SeedResult } from '@/scripts/seed';

/**
 * SPEC section 12: the demo account resets on a nightly cron.
 *
 * The reset *is* `npm run seed:reset` — `seedDemoAccount({ reset: true })`, the
 * same function the CLI entry point calls, which in turn uses Phase 8's
 * `buildDemoApplications`. There is deliberately no reset-specific generator: a
 * second definition of the fixture set would drift from the one the seed script
 * and the dashboard's "Load demo data" button already share.
 *
 * Registered by the same `startScheduledJobs` as the reminder sweep and the
 * purge, on the same `node-cron` infrastructure. It is its own task only because
 * it runs daily rather than hourly.
 */

/**
 * 04:20 UTC. Off the purge's 03:15 so two heavy jobs do not collide, and off the
 * hour boundary, since the digests tick every hour on the hour.
 */
export const DEMO_RESET_CRON_EXPRESSION = '20 4 * * *';

/**
 * Restores the demo account, or reports that there is nothing to restore.
 *
 * A deployment that never ran the seed has no demo account, and that is a
 * legitimate configuration — "Try the demo" answers 404 there. Skipping quietly
 * is right: erroring nightly about an optional fixture would train whoever reads
 * the logs to ignore them.
 */
export async function runDemoReset(): Promise<SeedResult | null> {
  const existing = await User.findOne({ email: env.DEMO_EMAIL, isDemo: true }).select('_id');

  if (!existing) {
    logger.info('Demo reset skipped: no demo account on this deployment');
    return null;
  }

  const result = await seedDemoAccount({ reset: true });

  logger.info('Demo account reset', {
    userId: result.userId,
    applications: result.applications,
  });

  return result;
}

export function startDemoResetCron(): ScheduledTask {
  return cron.schedule(
    DEMO_RESET_CRON_EXPRESSION,
    () => {
      void runDemoReset().catch((error: unknown) => {
        logger.error('Demo reset failed', {
          message: error instanceof Error ? error.message : String(error),
        });
      });
    },
    { timezone: 'UTC' },
  );
}
