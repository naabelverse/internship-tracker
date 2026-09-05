import { logger } from '@/config/logger';
import { Migration as MigrationLedger } from '@/models/Migration';

/** What one migration reports back, purely for the log line. */
export type MigrationOutcome = Record<string, number>;

export interface Migration {
  /** Sequential, matching the number in the filename, and never reused. */
  version: number;
  name: string;
  up: () => Promise<MigrationOutcome>;
}

export interface AppliedMigration {
  version: number;
  name: string;
  durationMs: number;
  outcome: MigrationOutcome;
}

export interface MigrationRunResult {
  applied: AppliedMigration[];
  skipped: number;
  currentVersion: number;
}

/** Refuses a set with a duplicate or out-of-order version before anything runs. */
export function assertSequential(migrations: Migration[]): void {
  const versions = migrations.map((migration) => migration.version);
  const duplicates = versions.filter((version, index) => versions.indexOf(version) !== index);

  if (duplicates.length > 0) {
    throw new Error(`Duplicate migration version(s): ${duplicates.join(', ')}`);
  }

  for (const [index, version] of versions.entries()) {
    if (index > 0 && version <= versions[index - 1]) {
      throw new Error(
        `Migrations must be listed in ascending version order: ${String(versions[index - 1])} is followed by ${String(version)}`,
      );
    }
  }
}

/**
 * Applies every migration this database has not seen, oldest first.
 *
 * Three properties make this safe to run on every deploy, including twice at
 * once during a rolling restart:
 *
 *  1. **Ordered.** The set is validated as strictly ascending before anything
 *     runs, so a version reused by two branches fails loudly rather than
 *     applying one and silently marking the other done.
 *  2. **Once only.** The ledger row is inserted with a unique `version`, so a
 *     second instance racing the first loses the insert and stops. Its
 *     migration will have run twice, which is why every migration must be
 *     idempotent - selecting on the old `schemaVersion` is what makes that true.
 *  3. **Fail fast.** A throwing migration aborts the run with the ledger
 *     unwritten, so the next attempt retries the same one rather than skipping
 *     past it into a migration that assumed it had succeeded.
 */
export async function runMigrations(migrations: Migration[]): Promise<MigrationRunResult> {
  assertSequential(migrations);

  const ledger = await MigrationLedger.find().sort({ version: 1 });
  const alreadyApplied = new Set(ledger.map((row) => row.version));
  const applied: AppliedMigration[] = [];

  for (const migration of migrations) {
    if (alreadyApplied.has(migration.version)) continue;

    const startedAt = Date.now();
    logger.info('Applying migration', { version: migration.version, name: migration.name });

    const outcome = await migration.up();
    const durationMs = Date.now() - startedAt;

    await MigrationLedger.create({
      version: migration.version,
      name: migration.name,
      appliedAt: new Date(),
      durationMs,
    });

    logger.info('Migration applied', {
      version: migration.version,
      name: migration.name,
      durationMs,
      ...outcome,
    });

    applied.push({ version: migration.version, name: migration.name, durationMs, outcome });
  }

  const versions = [...alreadyApplied, ...applied.map((entry) => entry.version)];

  return {
    applied,
    skipped: alreadyApplied.size,
    currentVersion: versions.length > 0 ? Math.max(...versions) : 0,
  };
}
