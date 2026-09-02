import type { Types } from 'mongoose';
import { Application } from '@/models/Application';
import { User } from '@/models/User';
import { getSummary, getTimeline } from '@/services/analytics.service';
import { buildTestApp, registerUser, useCleanAuthRateLimits } from './helpers/factories';
import { useTestDatabase } from './helpers/testDb';

useTestDatabase();
useCleanAuthRateLimits();

const app = buildTestApp();

const KL = 'Asia/Kuala_Lumpur';
const LA = 'America/Los_Angeles';

/**
 * Tuesday morning in Kuala Lumpur, still Monday evening in Los Angeles. Used as
 * "now" throughout, so the two accounts disagree about what today is.
 */
const NOW = new Date('2026-03-10T02:00:00Z');

let counter = 0;

async function seedUser(timeZone: string): Promise<Types.ObjectId> {
  const registered = await registerUser(app, { timezone: timeZone });
  const user = await User.findById(registered.userId);
  if (!user) throw new Error('user was not created');
  return user._id;
}

/** Creates an application whose createdAt is pinned to a chosen instant. */
async function seedApplicationAt(user: Types.ObjectId, createdAt: Date): Promise<void> {
  counter += 1;

  const application = await Application.create({
    user,
    company: `Company ${String(counter)}`,
    role: 'Intern',
    status: 'saved',
    statusHistory: [{ from: null, to: 'saved', changedAt: createdAt }],
  });

  // Through the native collection: mongoose protects the createdAt path, so a
  // model level update would silently leave it at the real insert time.
  await Application.collection.updateOne({ _id: application._id }, { $set: { createdAt } });
}

describe('analytics day boundaries follow the account timezone', () => {
  it('buckets one instant onto different local days for two accounts', async () => {
    // 02:00 UTC is 10:00 on 10 March in Kuala Lumpur, but 19:00 on 9 March in
    // Los Angeles: the same row belongs to a different calendar day for each.
    const instant = new Date('2026-03-10T02:00:00Z');
    const klUser = await seedUser(KL);
    const laUser = await seedUser(LA);

    await seedApplicationAt(klUser, instant);
    await seedApplicationAt(laUser, instant);

    const klPoints = await getTimeline(klUser, KL, 'day', '30d', NOW);
    const laPoints = await getTimeline(laUser, LA, 'day', '30d', NOW);

    // Each bucket is the start of that local day, expressed as a UTC instant:
    // midnight on 10 March in KL is 16:00 UTC on 9 March, while midnight on
    // 9 March in LA is 07:00 UTC that same day.
    expect(klPoints).toHaveLength(1);
    expect(klPoints[0].bucket).toBe('2026-03-09T16:00:00.000Z');

    expect(laPoints).toHaveLength(1);
    expect(laPoints[0].bucket).toBe('2026-03-09T07:00:00.000Z');

    expect(klPoints[0].bucket).not.toBe(laPoints[0].bucket);
  });

  it('computes different streaks from identical data', async () => {
    // 15:00 UTC is late on 9 March in KL; 17:00 UTC has already rolled over to
    // 10 March there. In Los Angeles both are still 9 March.
    const earlier = new Date('2026-03-09T15:00:00Z');
    const later = new Date('2026-03-09T17:00:00Z');

    const klUser = await seedUser(KL);
    const laUser = await seedUser(LA);

    for (const user of [klUser, laUser]) {
      await seedApplicationAt(user, earlier);
      await seedApplicationAt(user, later);
    }

    const klSummary = await getSummary(klUser, KL, 5, NOW);
    const laSummary = await getSummary(laUser, LA, 5, NOW);

    // KL sees two consecutive local days, 9 and 10 March, and today is the 10th.
    expect(klSummary.currentStreakDays).toBe(2);
    // LA sees a single local day, 9 March, which is still today there.
    expect(laSummary.currentStreakDays).toBe(1);

    // Same rows, same totals: only the day boundaries differ.
    expect(klSummary.total).toBe(2);
    expect(laSummary.total).toBe(2);
  });

  it('places one instant in different weeks for the weekly goal', async () => {
    // 18:00 UTC on Sunday 8 March is already Monday the 9th in Kuala Lumpur, so
    // it falls inside the current week there. In Los Angeles it is still Sunday
    // the 8th, which belongs to the previous week.
    const instant = new Date('2026-03-08T18:00:00Z');

    const klUser = await seedUser(KL);
    const laUser = await seedUser(LA);

    await seedApplicationAt(klUser, instant);
    await seedApplicationAt(laUser, instant);

    const klSummary = await getSummary(klUser, KL, 5, NOW);
    const laSummary = await getSummary(laUser, LA, 5, NOW);

    expect(klSummary.weeklyGoal.completed).toBe(1);
    expect(laSummary.weeklyGoal.completed).toBe(0);

    expect(klSummary.weeklyGoal.target).toBe(5);
    expect(klSummary.weeklyGoal.percentage).toBe(20);
    expect(laSummary.weeklyGoal.percentage).toBe(0);
  });

  it('never lets one account aggregation see another account rows', async () => {
    const klUser = await seedUser(KL);
    const laUser = await seedUser(LA);

    await seedApplicationAt(klUser, NOW);
    await seedApplicationAt(klUser, NOW);
    await seedApplicationAt(laUser, NOW);

    const klSummary = await getSummary(klUser, KL, 5, NOW);
    const laSummary = await getSummary(laUser, LA, 5, NOW);

    expect(klSummary.total).toBe(2);
    expect(laSummary.total).toBe(1);
  });
});
