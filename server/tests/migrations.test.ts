import { Application, CURRENT_APPLICATION_SCHEMA_VERSION } from '@/models/Application';
import { Migration as MigrationLedger } from '@/models/Migration';
import { CURRENT_USER_SCHEMA_VERSION, User } from '@/models/User';
import { migrations } from '@/migrations';
import { assertSequential, runMigrations, type Migration } from '@/migrations/runner';
import { useTestDatabase } from './helpers/testDb';

useTestDatabase();

/** A migration that records the order it ran in, so sequencing can be asserted. */
function spy(version: number, order: number[]): Migration {
  return {
    version,
    name: `spy-${String(version)}`,
    up: () => {
      order.push(version);
      return Promise.resolve({ touched: version });
    },
  };
}

describe('the migration set shipped in this repository', () => {
  it('is strictly ascending, with no reused version', () => {
    expect(() => {
      assertSequential(migrations);
    }).not.toThrow();
  });

  it('starts at 1 and is not empty, so the mechanism is real', () => {
    expect(migrations.length).toBeGreaterThan(0);
    expect(migrations[0].version).toBe(1);
  });
});

describe('assertSequential', () => {
  it('rejects a duplicate version, which two branches can easily both claim', () => {
    const order: number[] = [];

    expect(() => {
      assertSequential([spy(1, order), spy(2, order), spy(2, order)]);
    }).toThrow(/duplicate migration version/i);
  });

  it('rejects a set listed out of order', () => {
    const order: number[] = [];

    expect(() => {
      assertSequential([spy(2, order), spy(1, order)]);
    }).toThrow(/ascending/i);
  });
});

describe('runMigrations', () => {
  it('applies pending migrations oldest first and records each one', async () => {
    const order: number[] = [];

    const result = await runMigrations([spy(1, order), spy(2, order), spy(3, order)]);

    expect(order).toEqual([1, 2, 3]);
    expect(result.applied.map((entry) => entry.version)).toEqual([1, 2, 3]);
    expect(result.currentVersion).toBe(3);
    expect(result.skipped).toBe(0);

    const ledger = await MigrationLedger.find().sort({ version: 1 });
    expect(ledger.map((row) => row.name)).toEqual(['spy-1', 'spy-2', 'spy-3']);
    expect(ledger[0].appliedAt).toBeInstanceOf(Date);
    expect(ledger[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it('is idempotent: a second run applies nothing', async () => {
    const order: number[] = [];
    const set = [spy(1, order), spy(2, order)];

    await runMigrations(set);
    const second = await runMigrations(set);

    expect(order).toEqual([1, 2]);
    expect(second.applied).toEqual([]);
    expect(second.skipped).toBe(2);
    expect(second.currentVersion).toBe(2);
    expect(await MigrationLedger.countDocuments()).toBe(2);
  });

  it('applies only the new one when a migration is appended later', async () => {
    const order: number[] = [];

    await runMigrations([spy(1, order), spy(2, order)]);
    const result = await runMigrations([spy(1, order), spy(2, order), spy(3, order)]);

    expect(order).toEqual([1, 2, 3]);
    expect(result.applied.map((entry) => entry.version)).toEqual([3]);
    expect(result.skipped).toBe(2);
  });

  it('stops at a failure with the ledger unwritten, so the next run retries it', async () => {
    const order: number[] = [];

    const failing: Migration = {
      version: 2,
      name: 'explodes',
      up: () => Promise.reject(new Error('column does not exist')),
    };

    await expect(runMigrations([spy(1, order), failing, spy(3, order)])).rejects.toThrow(
      'column does not exist',
    );

    // 1 committed, 2 did not, and 3 was never reached - which is what stops a
    // later migration running against a shape its predecessor never produced.
    expect(order).toEqual([1]);
    const ledger = await MigrationLedger.find();
    expect(ledger.map((row) => row.version)).toEqual([1]);
  });

  it('refuses a badly ordered set before running any of it', async () => {
    const order: number[] = [];

    await expect(runMigrations([spy(2, order), spy(1, order)])).rejects.toThrow(/ascending/i);

    expect(order).toEqual([]);
    expect(await MigrationLedger.countDocuments()).toBe(0);
  });

  it('reports version 0 for a database that has never been migrated', async () => {
    const result = await runMigrations([]);

    expect(result.currentVersion).toBe(0);
    expect(result.applied).toEqual([]);
  });
});

describe('001-backfill-schema-version, the worked example', () => {
  it('is a no-op on a database this application created', async () => {
    await User.create({
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      password: 'Str0ngPassw0rd',
      acceptedTermsAt: new Date(),
    });

    const result = await runMigrations(migrations);
    const applied = result.applied.find((entry) => entry.version === 1);

    // Every document written since Phase 2 already carries the field, because
    // the schema defaults it. Matching nothing is the correct outcome.
    expect(applied?.outcome).toEqual({ users: 0, applications: 0 });
  });

  it('backfills a document that predates the field, which a restore can produce', async () => {
    const user = await User.create({
      name: 'Grace Hopper',
      email: 'grace@example.com',
      password: 'Str0ngPassw0rd',
      acceptedTermsAt: new Date(),
    });

    const application = await Application.create({
      user: user._id,
      company: 'Restored From Backup',
      role: 'Intern',
    });

    // Strip the field the way a document written before it existed would look.
    await User.collection.updateOne({ _id: user._id }, { $unset: { schemaVersion: '' } });
    await Application.collection.updateOne(
      { _id: application._id },
      { $unset: { schemaVersion: '' } },
    );

    const result = await runMigrations(migrations);
    const applied = result.applied.find((entry) => entry.version === 1);

    expect(applied?.outcome).toEqual({ users: 1, applications: 1 });

    expect((await User.findById(user._id))?.schemaVersion).toBe(CURRENT_USER_SCHEMA_VERSION);
    expect((await Application.findById(application._id))?.schemaVersion).toBe(
      CURRENT_APPLICATION_SCHEMA_VERSION,
    );
  });

  it('is safe to re-run: the second pass selects nothing', async () => {
    const user = await User.create({
      name: 'Grace Hopper',
      email: 'grace@example.com',
      password: 'Str0ngPassw0rd',
      acceptedTermsAt: new Date(),
    });
    await User.collection.updateOne({ _id: user._id }, { $unset: { schemaVersion: '' } });

    // Directly rather than through the runner, because the runner would skip it
    // on the second call - what is being asserted here is that the migration
    // itself is idempotent, which is what makes a crashed run recoverable.
    expect(await migrations[0].up()).toEqual({ users: 1, applications: 0 });
    expect(await migrations[0].up()).toEqual({ users: 0, applications: 0 });
  });
});

describe('002-retire-legacy-sources', () => {
  const retireLegacySources = migrations[1];
  const TOUCHED_AT = new Date('2026-01-01T00:00:00.000Z');

  /** Inserts rows directly, since the API no longer accepts the retired value. */
  async function seedRows(): Promise<void> {
    const user = await User.create({
      name: 'Grace Hopper',
      email: 'grace@example.com',
      password: 'Str0ngPassw0rd',
      acceptedTermsAt: new Date(),
    });
    const row = { user: user._id, role: 'Intern', updatedAt: TOUCHED_AT, createdAt: TOUCHED_AT };

    await Application.collection.insertMany([
      { ...row, company: 'Old One', source: 'internshala' },
      { ...row, company: 'Old Two', source: 'internshala' },
      { ...row, company: 'Current', source: 'linkedin' },
      { ...row, company: 'Specified', source: 'other', sourceOther: 'Glints' },
    ]);
  }

  it('is the second migration in the shipped set', () => {
    expect(retireLegacySources.version).toBe(2);
    expect(retireLegacySources.name).toBe('retire-legacy-sources');
  });

  it('rewrites Internshala to other, keeping the name as the specify text', async () => {
    await seedRows();

    expect(await retireLegacySources.up()).toEqual({ internshala: 2 });

    const rows = await Application.find().sort({ company: 1 }).lean();
    expect(rows.map((row) => [row.company, row.source, row.sourceOther])).toEqual([
      ['Current', 'linkedin', undefined],
      ['Old One', 'other', 'Internshala'],
      ['Old Two', 'other', 'Internshala'],
      ['Specified', 'other', 'Glints'],
    ]);
  });

  it('leaves updatedAt alone, since the user edited nothing', async () => {
    await seedRows();

    await retireLegacySources.up();

    const rows = await Application.find().lean();
    expect(rows.every((row) => row.updatedAt.getTime() === TOUCHED_AT.getTime())).toBe(true);
  });

  it('is safe to re-run: the second pass selects nothing', async () => {
    await seedRows();

    expect(await retireLegacySources.up()).toEqual({ internshala: 2 });
    expect(await retireLegacySources.up()).toEqual({ internshala: 0 });
  });
});
