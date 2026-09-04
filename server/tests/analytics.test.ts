import { Types, type InsertManyOptions } from 'mongoose';
import request from 'supertest';
import { Application } from '@/models/Application';
import { startOfLocalWeek } from '@/utils/dates';
import {
  APPLICATIONS_BASE,
  buildTestApp,
  createApplicationFor,
  registerUser,
  useCleanAuthRateLimits,
} from './helpers/factories';
import { useTestDatabase } from './helpers/testDb';

useTestDatabase();
useCleanAuthRateLimits();

const app = buildTestApp();
const ANALYTICS = '/api/v1/analytics';

const get = (path: string, token: string): request.Test =>
  request(app).get(`${ANALYTICS}${path}`).set('Authorization', `Bearer ${token}`);

/**
 * A deliberately shaped cohort:
 *  - one never applied
 *  - one applied then rejected (responded)
 *  - one reached interview (responded, interviewed)
 *  - one reached offer (responded, interviewed, offered)
 */
async function seedCohort(token: string): Promise<void> {
  const advance = async (id: string, statuses: string[]): Promise<void> => {
    for (const status of statuses) {
      await request(app)
        .patch(`${APPLICATIONS_BASE}/${id}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status });
    }
  };

  await createApplicationFor(app, token, { company: 'Saved Co', source: 'linkedin' });

  const rejected = await createApplicationFor(app, token, { company: 'Grab', source: 'linkedin' });
  await advance(rejected.id, ['applied', 'rejected']);

  const interviewing = await createApplicationFor(app, token, {
    company: 'Shopee',
    source: 'referral',
  });
  await advance(interviewing.id, ['applied', 'assessment', 'interview']);

  const offered = await createApplicationFor(app, token, { company: 'Grab', source: 'referral' });
  await advance(offered.id, ['applied', 'interview', 'offer']);
}

describe('analytics endpoints', () => {
  it('requires authentication on every endpoint', async () => {
    for (const path of [
      '/summary',
      '/status-breakdown',
      '/timeline',
      '/by-source',
      '/funnel',
      '/top-companies',
    ]) {
      const response = await request(app).get(`${ANALYTICS}${path}`);
      expect(response.status).toBe(401);
    }
  });

  describe('GET /summary', () => {
    it('derives counts and rates from the status history', async () => {
      const { accessToken } = await registerUser(app);
      await seedCohort(accessToken);

      const response = await get('/summary', accessToken);

      expect(response.status).toBe(200);
      expect(response.body.data).toMatchObject({
        total: 4,
        applied: 3,
        responded: 3,
        interviewed: 2,
        offers: 1,
        responseRate: 100,
        active: 1,
      });
      expect(response.body.data.interviewRate).toBeCloseTo(66.7, 1);
      expect(response.body.data.offerRate).toBeCloseTo(33.3, 1);
    });

    it('returns zeroes rather than dividing by zero on an empty account', async () => {
      const { accessToken } = await registerUser(app);

      const response = await get('/summary', accessToken);

      expect(response.body.data).toMatchObject({
        total: 0,
        applied: 0,
        responseRate: 0,
        interviewRate: 0,
        offerRate: 0,
        currentStreakDays: 0,
        avgDaysToFirstResponse: null,
      });
    });

    it('reports weekly goal progress against the target on the account', async () => {
      const { accessToken } = await registerUser(app);
      await createApplicationFor(app, accessToken);

      const response = await get('/summary', accessToken);

      expect(response.body.data.weeklyGoal.target).toBe(5);
      expect(response.body.data.weeklyGoal.completed).toBe(1);
      expect(response.body.data.weeklyGoal.percentage).toBe(20);
    });
  });
});

const MS_PER_DAY = 86_400_000;

/**
 * Writes rows straight to the collection with `timestamps: false`, because the
 * window a row falls in is decided by `createdAt` and the API has no way to
 * back-date one. Every row carries a real `statusHistory`, so the cohort
 * metrics are derived the same way they are in production.
 */
async function seedAgedApplications(
  userId: string,
  rows: { daysAgo: number; status: 'saved' | 'applied' | 'interview' }[],
): Promise<void> {
  const now = Date.now();

  await Application.insertMany(
    rows.map((row, index) => {
      const createdAt = new Date(now - row.daysAgo * MS_PER_DAY);
      const path = row.status === 'saved' ? ['saved'] : ['saved', row.status];

      return {
        user: new Types.ObjectId(userId),
        company: `Aged ${String(index)}`,
        role: 'Software Engineer Intern',
        employmentType: 'internship',
        status: row.status,
        priority: 'medium',
        source: 'linkedin',
        tags: [],
        statusHistory: path.map((to, step) => ({
          from: step === 0 ? null : path[step - 1],
          to,
          changedAt: new Date(createdAt.getTime() + step * MS_PER_DAY),
        })),
        createdAt,
        updatedAt: createdAt,
      };
    }),
    // See demoData.service: the option works, the published type omits it.
    { timestamps: false } as InsertManyOptions,
  );
}

describe('GET /summary period deltas', () => {
  it('splits the cohort into the current window and the one before it', async () => {
    const { accessToken, userId } = await registerUser(app);
    await seedAgedApplications(userId, [
      { daysAgo: 2, status: 'applied' },
      { daysAgo: 9, status: 'interview' },
      { daysAgo: 20, status: 'saved' },
      { daysAgo: 40, status: 'applied' },
      { daysAgo: 55, status: 'saved' },
      // Older than both windows, so it counts towards the all-time total only.
      { daysAgo: 120, status: 'applied' },
    ]);

    const response = await get('/summary', accessToken);

    expect(response.status).toBe(200);
    expect(response.body.data.total).toBe(6);
    expect(response.body.data.period.days).toBe(30);
    expect(response.body.data.period.current).toMatchObject({ created: 3, interviewed: 1 });
    expect(response.body.data.period.previous).toMatchObject({ created: 2, interviewed: 0 });
  });

  it('measures the response rate on each window own cohort', async () => {
    const { accessToken, userId } = await registerUser(app);
    await seedAgedApplications(userId, [
      // Current window: one of two applied rows reached interview, so 50%.
      { daysAgo: 3, status: 'applied' },
      { daysAgo: 4, status: 'interview' },
      // Previous window: both applied rows reached interview, so 100%.
      { daysAgo: 35, status: 'interview' },
      { daysAgo: 45, status: 'interview' },
    ]);

    const response = await get('/summary', accessToken);

    expect(response.body.data.period.current.responseRate).toBe(50);
    expect(response.body.data.period.previous.responseRate).toBe(100);
  });

  it('honours a caller supplied window length', async () => {
    const { accessToken, userId } = await registerUser(app);
    await seedAgedApplications(userId, [
      { daysAgo: 2, status: 'applied' },
      { daysAgo: 9, status: 'applied' },
    ]);

    const response = await get('/summary?periodDays=7', accessToken);

    expect(response.body.data.period.days).toBe(7);
    expect(response.body.data.period.current.created).toBe(1);
    expect(response.body.data.period.previous.created).toBe(1);
  });

  it('rejects a window length outside the allowed range', async () => {
    const { accessToken } = await registerUser(app);

    const response = await get('/summary?periodDays=0', accessToken);

    expect(response.status).toBe(400);
  });

  it('reports last week completed alongside this week for the goal card', async () => {
    const { accessToken, userId } = await registerUser(app);
    // Placed relative to the account own week start, which is what the service
    // uses, so the fixture cannot drift into the wrong week on a Monday run.
    const weekStart = startOfLocalWeek(new Date(), 'UTC').getTime();
    const daysAgo = (at: number): number => (Date.now() - at) / MS_PER_DAY;

    await seedAgedApplications(userId, [
      { daysAgo: daysAgo(weekStart + MS_PER_DAY / 2), status: 'saved' },
      { daysAgo: daysAgo(weekStart - MS_PER_DAY * 2), status: 'saved' },
      { daysAgo: daysAgo(weekStart - MS_PER_DAY * 5), status: 'saved' },
    ]);

    const response = await get('/summary', accessToken);

    expect(response.body.data.weeklyGoal.completed).toBe(1);
    expect(response.body.data.weeklyGoal.previousCompleted).toBe(2);
  });

  it('returns an empty comparison rather than dividing by zero', async () => {
    const { accessToken } = await registerUser(app);

    const response = await get('/summary', accessToken);

    expect(response.body.data.period.current).toMatchObject({ created: 0, responseRate: 0 });
    expect(response.body.data.period.previous).toMatchObject({ created: 0, responseRate: 0 });
    expect(response.body.data.weeklyGoal.previousCompleted).toBe(0);
  });
});

describe('analytics grouping endpoints', () => {
  it('returns every status in the breakdown, including the empty ones', async () => {
    const { accessToken } = await registerUser(app);
    await seedCohort(accessToken);

    const response = await get('/status-breakdown', accessToken);
    const rows = response.body.data.breakdown as { status: string; count: number }[];
    const byStatus = new Map(rows.map((row) => [row.status, row.count]));

    expect(rows).toHaveLength(8);
    expect(byStatus.get('saved')).toBe(1);
    expect(byStatus.get('rejected')).toBe(1);
    expect(byStatus.get('interview')).toBe(1);
    expect(byStatus.get('offer')).toBe(1);
    expect(byStatus.get('ghosted')).toBe(0);
  });

  it('reports each funnel stage with both conversion rates', async () => {
    const { accessToken } = await registerUser(app);
    await seedCohort(accessToken);

    const response = await get('/funnel', accessToken);
    const stages = response.body.data.stages as {
      stage: string;
      count: number;
      conversionFromApplied: number;
      conversionFromPrevious: number;
    }[];

    expect(stages.map((stage) => stage.stage)).toEqual([
      'applied',
      'assessment',
      'interview',
      'offer',
    ]);
    expect(stages.map((stage) => stage.count)).toEqual([3, 1, 2, 1]);
    expect(stages[0].conversionFromPrevious).toBe(100);
    expect(stages[3].conversionFromApplied).toBeCloseTo(33.3, 1);
  });

  it('groups by source, busiest first', async () => {
    const { accessToken } = await registerUser(app);
    await seedCohort(accessToken);

    const response = await get('/by-source', accessToken);

    expect(response.body.data.sources).toEqual([
      { source: 'linkedin', count: 2 },
      { source: 'referral', count: 2 },
    ]);
  });

  it('groups by company and honours the limit', async () => {
    const { accessToken } = await registerUser(app);
    await seedCohort(accessToken);

    const response = await get('/top-companies?limit=2', accessToken);
    const companies = response.body.data.companies as { company: string; count: number }[];

    expect(companies).toHaveLength(2);
    expect(companies[0]).toEqual({ company: 'Grab', count: 2 });
  });

  it('buckets created records and status changes on the timeline', async () => {
    const { accessToken } = await registerUser(app);
    await seedCohort(accessToken);

    const response = await get('/timeline?granularity=day&range=30d', accessToken);

    expect(response.body.data.granularity).toBe('day');
    const points = response.body.data.points as { created: number; statusChanges: number }[];
    expect(points).toHaveLength(1);
    expect(points[0].created).toBe(4);
    // Four opening entries, plus the eight transitions the cohort makes:
    // two for the rejected record, three each for the interviewing and offered ones.
    expect(points[0].statusChanges).toBe(12);
  });

  it('rejects an unknown granularity', async () => {
    const { accessToken } = await registerUser(app);

    const response = await get('/timeline?granularity=fortnight', accessToken);

    expect(response.status).toBe(400);
  });
});

/**
 * The dashboard's day/week/month switch. Only `day` was covered, which left the
 * `startOfWeek: 'monday'` branch of the `$dateTrunc` unproven — and MongoDB
 * defaults that to Sunday, so dropping it would silently shift every weekly
 * bucket by a day rather than fail loudly.
 *
 * The assertions are on the bucket boundaries themselves rather than on counts
 * per bucket, so they hold whichever weekday the suite happens to run on.
 */
describe('GET /timeline granularity', () => {
  /** Ninety days of activity, wide enough to span several weeks and months. */
  const SPREAD = [0, 3, 9, 16, 24, 33, 45, 58, 71, 86].map((daysAgo) => ({
    daysAgo,
    status: 'applied' as const,
  }));

  interface TimelineBody {
    data: { granularity: string; points: { bucket: string; created: number }[] };
  }

  const pointsFrom = (body: TimelineBody): { bucket: string; created: number }[] =>
    body.data.points;

  const totalCreated = (body: TimelineBody): number =>
    body.data.points.reduce((sum, point) => sum + point.created, 0);

  it('starts every weekly bucket on a Monday, not the Mongo default of Sunday', async () => {
    const { accessToken, userId } = await registerUser(app);
    await seedAgedApplications(userId, SPREAD);

    const response = await get('/timeline?granularity=week&range=90d', accessToken);
    const points = pointsFrom(response.body as TimelineBody);

    expect(response.status).toBe(200);
    expect(response.body.data.granularity).toBe('week');
    expect(points.length).toBeGreaterThan(1);

    for (const point of points) {
      const bucket = new Date(point.bucket);
      expect(bucket.getUTCDay()).toBe(1);
      expect(bucket.toISOString()).toMatch(/T00:00:00\.000Z$/);
    }
  });

  it('starts every monthly bucket on the first of the month', async () => {
    const { accessToken, userId } = await registerUser(app);
    await seedAgedApplications(userId, SPREAD);

    const response = await get('/timeline?granularity=month&range=90d', accessToken);
    const points = pointsFrom(response.body as TimelineBody);

    expect(response.body.data.granularity).toBe('month');
    expect(points.length).toBeGreaterThan(1);

    for (const point of points) {
      const bucket = new Date(point.bucket);
      expect(bucket.getUTCDate()).toBe(1);
      expect(bucket.toISOString()).toMatch(/T00:00:00\.000Z$/);
    }
  });

  it('keeps the same rows however coarsely they are bucketed', async () => {
    const { accessToken, userId } = await registerUser(app);
    await seedAgedApplications(userId, SPREAD);

    const [byDay, byWeek, byMonth] = await Promise.all([
      get('/timeline?granularity=day&range=90d', accessToken),
      get('/timeline?granularity=week&range=90d', accessToken),
      get('/timeline?granularity=month&range=90d', accessToken),
    ]);

    // Coarser granularity must merge buckets, never drop or invent rows.
    expect(totalCreated(byDay.body as TimelineBody)).toBe(SPREAD.length);
    expect(totalCreated(byWeek.body as TimelineBody)).toBe(SPREAD.length);
    expect(totalCreated(byMonth.body as TimelineBody)).toBe(SPREAD.length);

    const dayCount = pointsFrom(byDay.body as TimelineBody).length;
    const weekCount = pointsFrom(byWeek.body as TimelineBody).length;
    const monthCount = pointsFrom(byMonth.body as TimelineBody).length;

    expect(monthCount).toBeLessThanOrEqual(weekCount);
    expect(weekCount).toBeLessThanOrEqual(dayCount);
  });
});
