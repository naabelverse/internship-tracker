import { Schema, model, type HydratedDocument, type Model } from 'mongoose';

export interface MigrationAttributes {
  /** The sequential number from the migration filename, unique across the set. */
  version: number;
  name: string;
  appliedAt: Date;
  durationMs: number;
}

export type MigrationModelType = Model<MigrationAttributes>;
export type MigrationDocument = HydratedDocument<MigrationAttributes>;

/**
 * The ledger of migrations already applied to this database.
 *
 * One row per migration rather than a single "current version" counter: a
 * counter cannot tell you when a migration ran or how long it took, and it
 * silently hides a gap if someone applies migrations out of order by hand.
 *
 * `version` is unique, which is what makes the runner safe against two
 * instances booting at the same moment - the second insert fails rather than
 * running the same migration twice.
 */
const migrationSchema = new Schema<MigrationAttributes, MigrationModelType>(
  {
    version: { type: Number, required: true, unique: true },
    name: { type: String, required: true },
    appliedAt: { type: Date, required: true },
    durationMs: { type: Number, required: true, min: 0 },
  },
  { collection: 'migrations', versionKey: false },
);

export const Migration = model<MigrationAttributes, MigrationModelType>(
  'Migration',
  migrationSchema,
);
