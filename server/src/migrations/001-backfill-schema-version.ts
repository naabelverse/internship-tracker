import { Application, CURRENT_APPLICATION_SCHEMA_VERSION } from '@/models/Application';
import { CURRENT_USER_SCHEMA_VERSION, User } from '@/models/User';
import type { Migration, MigrationOutcome } from '@/migrations/runner';

/**
 * The worked example, and a real no-op on any database this application created.
 *
 * `schemaVersion` has a schema default, so every document written since Phase 2
 * already carries it. What this covers is the one case a default cannot: a
 * document that predates the field, which a restored backup or a hand-inserted
 * fixture can still produce. On a normal database it matches nothing and reports
 * zero, which is what a safe migration looks like before it is needed.
 *
 * It is also the template. A migration that really changes shape - say splitting
 * `contact.name` into `firstName` and `lastName` - keeps this structure and
 * changes only the filter and the update: select documents at the old version,
 * write the new fields, stamp the new version. Selecting on `schemaVersion` is
 * what makes a re-run harmless, because the second pass matches nothing.
 */
export const migration: Migration = {
  version: 1,
  name: 'backfill-schema-version',

  async up(): Promise<MigrationOutcome> {
    const [users, applications] = await Promise.all([
      User.updateMany(
        { schemaVersion: { $exists: false } },
        { $set: { schemaVersion: CURRENT_USER_SCHEMA_VERSION } },
      ),
      Application.updateMany(
        { schemaVersion: { $exists: false } },
        { $set: { schemaVersion: CURRENT_APPLICATION_SCHEMA_VERSION } },
      ),
    ]);

    return { users: users.modifiedCount, applications: applications.modifiedCount };
  },
};
