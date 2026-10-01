import { Application } from '@/models/Application';
import type { Migration, MigrationOutcome } from '@/migrations/runner';

/**
 * Each retired source, with the name kept as the "please specify" text. Written
 * out here rather than read from the model: the model no longer knows these
 * values, and a migration has to keep meaning what it meant when it shipped.
 */
const RETIRED = { internshala: 'Internshala' } as const;

/**
 * Rewrites every retired source to `other`, keeping the platform's name as the
 * "please specify" text so nothing the user recorded is lost.
 *
 * This is a hard prerequisite for the release that ships it, not a tidy-up: the
 * model's enum no longer includes these values, and every save re-validates the
 * paths it loaded, so a row this has not reached fails its next edit or board
 * drag. Run it, confirm no retired value remains, then deploy.
 *
 * Running first is safe because the result is a shape the previous release
 * already reads (`other` was in its list, and it ignores `sourceOther`). The
 * filter is the old value itself, so a second run matches nothing.
 *
 * Timestamps are left alone: this is housekeeping, not an edit the user made, and
 * bumping `updatedAt` would reorder anyone's "recently updated" view.
 */
export const migration: Migration = {
  version: 2,
  name: 'retire-legacy-sources',

  async up(): Promise<MigrationOutcome> {
    const outcome: MigrationOutcome = {};

    for (const [retired, label] of Object.entries(RETIRED)) {
      const result = await Application.updateMany(
        { source: retired },
        { $set: { source: 'other', sourceOther: label } },
        { timestamps: false },
      );
      outcome[retired] = result.modifiedCount;
    }

    return outcome;
  },
};
