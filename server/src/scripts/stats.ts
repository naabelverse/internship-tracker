import { connectDatabase, disconnectDatabase } from '@/config/db';
import { logger } from '@/config/logger';
import { Application } from '@/models/Application';
import { User } from '@/models/User';

const RECENT_SIGNUP_WINDOW_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** The counts `npm run stats` reports. */
export interface InstanceStats {
  users: number;
  deletedUsers: number;
  applications: number;
  signupsLast7Days: number;
}

/**
 * Counts what an operator wants to know about a running instance.
 *
 * Soft-deleted accounts are counted separately rather than folded into the
 * total: they are still on disk until the purge job reaches them, so a single
 * number would misreport both the live user base and the storage in use.
 */
export async function collectStats(now: Date = new Date()): Promise<InstanceStats> {
  const since = new Date(now.getTime() - RECENT_SIGNUP_WINDOW_DAYS * MS_PER_DAY);

  const [users, deletedUsers, applications, signupsLast7Days] = await Promise.all([
    User.countDocuments({ deletedAt: null }),
    User.countDocuments({ deletedAt: { $ne: null } }),
    Application.countDocuments({}),
    User.countDocuments({ deletedAt: null, createdAt: { $gte: since } }),
  ]);

  return { users, deletedUsers, applications, signupsLast7Days };
}

/**
 * `npm run stats` — SPEC section 14's operator visibility, deliberately a script
 * rather than an admin UI: it needs no authentication surface, no route and no
 * role model, and it runs against production from a shell that already holds the
 * connection string.
 */
async function main(): Promise<void> {
  await connectDatabase();

  try {
    const stats = await collectStats();

    process.stdout.write(
      [
        `Users (active):          ${stats.users}`,
        `Users (soft-deleted):    ${stats.deletedUsers}`,
        `Applications:            ${stats.applications}`,
        `Signups (last 7 days):   ${stats.signupsLast7Days}`,
        '',
      ].join('\n'),
    );
  } finally {
    await disconnectDatabase();
  }
}

main().catch((error: unknown) => {
  logger.error('Stats run failed', {
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
  process.exitCode = 1;
});
