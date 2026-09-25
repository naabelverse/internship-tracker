import { parseArgs } from 'node:util';
import { connectDatabase, disconnectDatabase } from '@/config/db';
import { logger } from '@/config/logger';
import type { FileErasureResult } from '@/services/attachment.service';
import {
  applySweep,
  ATTACHMENT_PREFIX,
  groupOrphansByUser,
  isMajority,
  planSweep,
  SweepRefusedError,
  type SweepPlan,
} from '@/services/storageSweep.service';
import { getStorage, type StorageAdapter, type StoredObjectInfo } from '@/storage';

export interface SweepOptions {
  apply: boolean;
  expect?: number;
  allowMajority: boolean;
}

/**
 * Reads the command line. Anything unexpected is an error rather than ignored,
 * because a mistyped flag on a destructive script should stop it, not be dropped.
 */
export function parseSweepArgs(argv: string[]): SweepOptions {
  const { values } = parseArgs({
    args: argv,
    strict: true,
    allowPositionals: false,
    options: {
      apply: { type: 'boolean', default: false },
      expect: { type: 'string' },
      'allow-majority': { type: 'boolean', default: false },
    },
  });

  const apply = values.apply;
  const allowMajority = values['allow-majority'];

  if (!apply && (values.expect !== undefined || allowMajority)) {
    throw new Error('--expect and --allow-majority only apply together with --apply.');
  }

  if (values.expect === undefined) return { apply, allowMajority };

  if (!/^\d+$/.test(values.expect)) {
    throw new Error(`--expect must be a whole number, got "${values.expect}".`);
  }

  return { apply, expect: Number(values.expect), allowMajority };
}

function formatBytes(bytes: number): string {
  return `${String(bytes)} bytes (${(bytes / (1024 * 1024)).toFixed(2)} MB)`;
}

const totalBytes = (objects: StoredObjectInfo[]): number =>
  objects.reduce((sum, object) => sum + object.size, 0);

/** The human-readable report, printed on every run whether or not it deletes. */
export function formatSweepReport(
  plan: SweepPlan,
  options: SweepOptions,
  storage: StorageAdapter,
): string {
  const lines = [
    options.apply ? 'Storage sweep: APPLY' : 'Storage sweep: DRY RUN, nothing will be deleted',
    // Named up front, so an empty listing can be told apart from listing the wrong place.
    `Storage: ${storage.driver}, ${storage.location}`,
    '',
    `Listed under ${ATTACHMENT_PREFIX}:   ${String(plan.listed)}`,
    `Referenced (kept):          ${String(plan.referenced.length)}`,
    `Newer than 24 hours (kept): ${String(plan.recent.length)}`,
    `Unrecognised keys (kept):   ${String(plan.unrecognised.length)}`,
    `Orphans:                    ${String(plan.orphans.length)}, ${formatBytes(totalBytes(plan.orphans))}`,
    `Applications in database:   ${String(plan.applications)}`,
  ];

  const groups = groupOrphansByUser(plan.orphans);
  if (groups.length > 0) {
    lines.push('', 'Orphans by user id segment:');
    for (const group of groups) {
      lines.push(
        `  ${group.userId}: ${String(group.keys.length)} files, ${formatBytes(group.bytes)}`,
      );
      for (const key of group.keys) lines.push(`    ${key}`);
    }
  }

  if (plan.unrecognised.length > 0) {
    lines.push('', 'Unrecognised keys, never deleted by this script:');
    for (const object of plan.unrecognised) lines.push(`  ${object.key}`);
  }

  if (plan.applications === 0) {
    lines.push(
      '',
      'WARNING: the database has no applications. --apply will refuse. Check MONGO_URI.',
    );
  } else if (isMajority(plan)) {
    lines.push(
      '',
      'WARNING: orphans are a majority of stored files. --apply needs --allow-majority.',
    );
  }

  if (!options.apply && plan.orphans.length > 0) {
    lines.push(
      '',
      'To delete exactly these orphans:',
      `  npm run storage:sweep -w server -- --apply --expect ${String(plan.orphans.length)}` +
        (isMajority(plan) ? ' --allow-majority' : ''),
    );
  }

  return `${lines.join('\n')}\n`;
}

export interface SweepRunResult {
  plan: SweepPlan;
  /** Present only when `--apply` ran and every guard passed. */
  erasure?: FileErasureResult;
  output: string;
}

/**
 * Plans the sweep and, with `--apply`, deletes the orphans. Throws
 * SweepRefusedError, having deleted nothing, when a guard fails.
 */
export async function runStorageSweep(
  options: SweepOptions,
  { storage = getStorage(), now = new Date() }: { storage?: StorageAdapter; now?: Date } = {},
): Promise<SweepRunResult> {
  const plan = await planSweep(storage, now);
  const report = formatSweepReport(plan, options, storage);

  if (!options.apply) return { plan, output: report };

  const erasure = await applySweep(storage, plan, options);
  logger.info('Storage sweep applied', { ...erasure, listed: plan.listed });

  return {
    plan,
    erasure,
    output:
      `${report}\nDeleted ${String(erasure.erased)} files, ${String(erasure.failed)} failed.` +
      (erasure.failed > 0 ? ' The failed keys are in the error log above.\n' : '\n'),
  };
}

/**
 * `npm run storage:sweep` removes files orphaned before the #34 fix. A dry run
 * by default; `--apply --expect <count>` deletes, and only when the count
 * still matches what the dry run showed.
 */
async function main(): Promise<void> {
  const options = parseSweepArgs(process.argv.slice(2));

  await connectDatabase();

  try {
    const result = await runStorageSweep(options);
    process.stdout.write(result.output);
    if (result.erasure && result.erasure.failed > 0) process.exitCode = 1;
  } catch (error) {
    if (!(error instanceof SweepRefusedError)) throw error;
    process.stderr.write(`Refused, nothing was deleted: ${error.message}\n`);
    process.exitCode = 1;
  } finally {
    await disconnectDatabase();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    logger.error('Storage sweep failed', {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    process.exitCode = 1;
  });
}
