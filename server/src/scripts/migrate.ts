import { connectDatabase, disconnectDatabase } from '@/config/db';
import { logger } from '@/config/logger';
import { migrations, runMigrations } from '@/migrations';

/**
 * `npm run migrate`.
 *
 * Run this before the new server version starts, not from inside it: two
 * instances booting behind a rolling deploy would otherwise race, and a
 * migration that has to finish before the new code is correct must not be
 * competing with that code for the same documents.
 */
async function main(): Promise<void> {
  await connectDatabase();

  try {
    const result = await runMigrations(migrations);

    if (result.applied.length === 0) {
      logger.info('No pending migrations', { currentVersion: result.currentVersion });
    } else {
      logger.info('Migrations complete', {
        applied: result.applied.length,
        skipped: result.skipped,
        currentVersion: result.currentVersion,
      });
    }
  } finally {
    await disconnectDatabase();
  }
}

main().catch((error: unknown) => {
  logger.error('Migration run failed', {
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
  process.exitCode = 1;
});
