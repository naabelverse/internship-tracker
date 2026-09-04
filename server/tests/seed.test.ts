import { Types } from 'mongoose';
import { env } from '@/config/env';
import { Application } from '@/models/Application';
import { Reminder } from '@/models/Reminder';
import { User } from '@/models/User';
import { seedDemoAccount } from '@/scripts/seed';
import { useTestDatabase } from './helpers/testDb';

useTestDatabase();

const MS_PER_DAY = 86_400_000;
const NOW = new Date('2026-09-04T10:00:00.000Z');

/** SPEC section 9 fixes the floor at 60; the generator currently produces 64. */
const MINIMUM_APPLICATIONS = 60;

interface SeededRow {
  status: string;
  source?: string;
  tags: string[];
  deadline?: Date;
  createdAt: Date;
  interviews: { scheduledAt: Date }[];
  statusHistory: { to: string; changedAt: Date }[];
}

async function applicationsForSeed(): Promise<SeededRow[]> {
  const user = await User.findOne({ email: env.DEMO_EMAIL });

  if (!user) throw new Error('Seed did not create the demo user');

  return Application.find({ user: user._id }).lean<SeededRow[]>();
}

describe('seedDemoAccount', () => {
  it('creates the demo account with the published credentials', async () => {
    const result = await seedDemoAccount({ now: NOW });

    const user = await User.findOne({ email: env.DEMO_EMAIL }).select('+password');

    expect(result.userCreated).toBe(true);
    expect(result.email).toBe('demo@tracker.dev');
    expect(user).not.toBeNull();
    // The password is compared, never read back: proving the seed hashed it is
    // the point, and a stored plaintext would still pass a string equality check.
    expect(await user?.comparePassword(env.DEMO_PASSWORD)).toBe(true);
    expect(user?.isDemo).toBe(true);
    expect(user?.timezone).toBe('Asia/Kuala_Lumpur');
  });

  it('inserts more than the sixty applications the spec asks for', async () => {
    const result = await seedDemoAccount({ now: NOW });
    const rows = await applicationsForSeed();

    expect(result.applications).toBeGreaterThanOrEqual(MINIMUM_APPLICATIONS);
    expect(rows).toHaveLength(result.applications);
  });

  it('keeps the back-dated timestamps so the charts have six months of shape', async () => {
    await seedDemoAccount({ now: NOW });
    const rows = await applicationsForSeed();

    const oldest = Math.min(...rows.map((row) => row.createdAt.getTime()));
    const newest = Math.max(...rows.map((row) => row.createdAt.getTime()));
    const months = new Set(rows.map((row) => row.createdAt.toISOString().slice(0, 7)));

    // The regression this guards is real: without `timestamps: false` on the
    // insert, Mongoose overwrites every createdAt with the insert time and the
    // timeline, heatmap and streak all collapse onto a single day.
    expect(NOW.getTime() - oldest).toBeGreaterThan(150 * MS_PER_DAY);
    expect(NOW.getTime() - oldest).toBeLessThanOrEqual(183 * MS_PER_DAY);
    expect(newest).toBeLessThanOrEqual(NOW.getTime());
    expect(months.size).toBeGreaterThan(4);
  });

  it('gives every dashboard panel something to render', async () => {
    await seedDemoAccount({ now: NOW });
    const rows = await applicationsForSeed();

    const statuses = new Set(rows.map((row) => row.status));
    const sources = new Set(rows.map((row) => row.source).filter(Boolean));
    const withInterviews = rows.filter((row) => row.interviews.length > 0);
    const deadlines = rows.map((row) => row.deadline).filter((value): value is Date => !!value);

    expect(statuses.size).toBeGreaterThanOrEqual(6);
    expect(sources.size).toBeGreaterThanOrEqual(4);
    expect(new Set(rows.flatMap((row) => row.tags)).size).toBeGreaterThanOrEqual(5);
    expect(withInterviews.length).toBeGreaterThanOrEqual(5);
    // Both directions, so the deadline chips and the upcoming panel are exercised.
    expect(deadlines.some((deadline) => deadline < NOW)).toBe(true);
    expect(deadlines.some((deadline) => deadline >= NOW)).toBe(true);
    // The funnel, the timeline and the detail page timeline are all computed
    // from statusHistory, so an empty one would empty three panels at once.
    expect(rows.every((row) => row.statusHistory.length > 0)).toBe(true);
  });

  it('refuses to seed twice, so the numbers cannot silently double', async () => {
    const first = await seedDemoAccount({ now: NOW });

    await expect(seedDemoAccount({ now: NOW })).rejects.toThrow(/already holds applications/);

    expect(await applicationsForSeed()).toHaveLength(first.applications);
  });

  it('wipes and reseeds on reset, reusing the account rather than duplicating it', async () => {
    const first = await seedDemoAccount({ now: NOW });

    const second = await seedDemoAccount({ reset: true, now: NOW });

    expect(second.userCreated).toBe(false);
    expect(second.userId).toBe(first.userId);
    expect(await User.countDocuments({ email: env.DEMO_EMAIL })).toBe(1);
    expect(await applicationsForSeed()).toHaveLength(second.applications);
  });

  it('clears the reminders the account owned before reseeding', async () => {
    const { userId } = await seedDemoAccount({ now: NOW });
    await Reminder.create({
      user: new Types.ObjectId(userId),
      type: 'custom',
      title: 'Left over from an earlier seed',
      dueAt: NOW,
    });

    await seedDemoAccount({ reset: true, now: NOW });

    expect(await Reminder.countDocuments({ user: new Types.ObjectId(userId) })).toBe(0);
  });

  it('leaves another account untouched when it resets the demo one', async () => {
    const other = await User.create({
      name: 'Real Person',
      email: 'someone-else@example.com',
      password: 'Str0ngPassw0rd',
      acceptedTermsAt: NOW,
    });
    await Application.create({ user: other._id, company: 'Keep Me', role: 'Intern' });

    await seedDemoAccount({ now: NOW });
    await seedDemoAccount({ reset: true, now: NOW });

    expect(await Application.countDocuments({ user: other._id })).toBe(1);
    expect(await User.findById(other._id)).not.toBeNull();
  });
});
