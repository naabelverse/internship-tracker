import { Application, LEGACY_SOURCE_LABELS, type LegacySource } from '@/models/Application';
import type { Migration, MigrationOutcome } from '@/migrations/runner';

/**
 * Rewrites every retired source to `other`, keeping the platform's name as the
 * "please specify" text so nothing the user recorded is lost.
 *
 * The filter is the old value itself, so a second run matches nothing. The
 * resulting shape is also one the previous release reads cleanly (`other` was
 * already in its list and it ignores `sourceOther`), which is what lets this run
 * before the deploy that retires the value rather than after it.
 *
 * Timestamps are left alone: this is housekeeping, not an edit the user made, and
 * bumping `updatedAt` would reorder anyone's "recently updated" view.
 */
export const migration: Migration = {
  version: 2,
  name: 'retire-legacy-sources',

  async up(): Promise<MigrationOutcome> {
    const outcome: MigrationOutcome = {};

    for (const [legacy, label] of Object.entries(LEGACY_SOURCE_LABELS) as [
      LegacySource,
      string,
    ][]) {
      const result = await Application.updateMany(
        { source: legacy },
        { $set: { source: 'other', sourceOther: label } },
        { timestamps: false },
      );
      outcome[legacy] = result.modifiedCount;
    }

    return outcome;
  },
};
