import type { InsertManyOptions } from 'mongoose';
import { connectDatabase, disconnectDatabase } from '@/config/db';
import { env } from '@/config/env';
import { logger } from '@/config/logger';
import { Application } from '@/models/Application';
import { RefreshToken } from '@/models/RefreshToken';
import { Reminder } from '@/models/Reminder';
import { User, type UserDocument } from '@/models/User';
import { buildDemoApplications } from '@/services/demoData.service';

/**
 * SPEC section 9: `npm run seed` fills the demo account with a realistic six
 * month search, and `npm run seed:reset` wipes it first.
 *
 * The rows come from `buildDemoApplications`, the same generator behind the
 * dashboard's "Load demo data" button. There is deliberately no second
 * generator here: two definitions of "realistic data" would drift, and the one
 * that already exists clears SPEC section 9's bar on its own — 64 rows spread
 * over 182 days, every status, seven sources, interviews on the in-progress
 * records, past and upcoming deadlines, and a populated `statusHistory`.
 */

/** Profile fields that make the seeded dashboard read like a real account. */
const DEMO_PROFILE = {
  name: 'Demo Student',
  university: 'Universiti Malaya',
  gradYear: 2027,
  targetRoles: ['Software Engineer Intern', 'Backend Engineer Intern'],
  weeklyGoal: 5,
  theme: 'system' as const,
  timezone: 'Asia/Kuala_Lumpur',
  emailRemindersEnabled: true,
};

export interface SeedOptions {
  /** Wipe the demo account's data before inserting. Set by `seed:reset`. */
  reset?: boolean;
  /** Fixed clock, so a test can assert the spread it produces. */
  now?: Date;
}

export interface SeedResult {
  email: string;
  userId: string;
  applications: number;
  /** False when the account already existed and was reused rather than created. */
  userCreated: boolean;
  reset: boolean;
}

/**
 * Removes everything the demo account owns. Scoped by `user` for the same
 * reason every service query is: an unscoped `deleteMany({})` here would empty
 * a shared development database rather than one fixture account.
 */
async function wipeAccountData(user: UserDocument): Promise<void> {
  await Promise.all([
    Application.deleteMany({ user: user._id }),
    Reminder.deleteMany({ user: user._id }),
    RefreshToken.deleteMany({ user: user._id }),
  ]);
}

/**
 * Creates or reuses the demo user and fills it with the fixture set. Refuses an
 * account that already holds applications unless `reset` is set, so running the
 * script twice by accident cannot silently double the dashboard's numbers.
 */
export async function seedDemoAccount(options: SeedOptions = {}): Promise<SeedResult> {
  const { reset = false, now = new Date() } = options;

  const existing = await User.findOne({ email: env.DEMO_EMAIL });
  let user = existing;

  if (!user) {
    user = await User.create({
      ...DEMO_PROFILE,
      email: env.DEMO_EMAIL,
      password: env.DEMO_PASSWORD,
      // The demo account skips verification: there is no mail transport until
      // phase 12, and an unverified seed would block the flows it exists to show.
      emailVerified: true,
      acceptedTermsAt: now,
      lastLoginAt: now,
      isDemo: true,
    });
  } else if (reset) {
    // A reset restores the published credentials too, so an account left in an
    // odd state by manual poking comes back to a known one.
    user.password = env.DEMO_PASSWORD;
    user.set({ ...DEMO_PROFILE, isDemo: true, emailVerified: true });
    await user.save();
  }

  if (reset) {
    await wipeAccountData(user);
  } else {
    const held = await Application.countDocuments({ user: user._id }).limit(1);

    if (held > 0) {
      throw new Error(
        `${env.DEMO_EMAIL} already holds applications. Run "npm run seed:reset" to wipe and reseed.`,
      );
    }
  }

  const documents = buildDemoApplications(user._id, now);

  // `timestamps: false` is honoured at runtime but missing from Mongoose's
  // `InsertManyOptions` type. Without it the back-dated `createdAt` values are
  // overwritten with the insert time and every chart collapses onto today.
  await Application.insertMany(documents, { timestamps: false } as InsertManyOptions);

  return {
    email: env.DEMO_EMAIL,
    userId: user._id.toString(),
    applications: documents.length,
    userCreated: !existing,
    reset,
  };
}

/** Connects, seeds, reports, disconnects. The `npm run seed` entry point. */
async function main(): Promise<void> {
  const reset = process.argv.includes('--reset');

  await connectDatabase();

  try {
    const result = await seedDemoAccount({ reset });

    logger.info('Seed complete', result);
    logger.info(`Sign in with ${result.email} / ${env.DEMO_PASSWORD}`);
  } finally {
    await disconnectDatabase();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    logger.error('Seed failed', {
      message: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
    void disconnectDatabase();
  });
}
