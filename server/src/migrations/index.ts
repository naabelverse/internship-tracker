import { migration as backfillSchemaVersion } from '@/migrations/001-backfill-schema-version';
import { migration as retireLegacySources } from '@/migrations/002-retire-legacy-sources';
import type { Migration } from '@/migrations/runner';

/**
 * Every migration, in the order they must be applied.
 *
 * A new migration is added by writing `NNN-what-it-does.ts` next to this file
 * and appending it here. The runner validates that the versions are strictly
 * ascending, so appending in the wrong place fails at startup rather than
 * halfway through a production deploy.
 */
export const migrations: Migration[] = [backfillSchemaVersion, retireLegacySources];

export { runMigrations, assertSequential } from '@/migrations/runner';
export type { Migration, MigrationRunResult, AppliedMigration } from '@/migrations/runner';
