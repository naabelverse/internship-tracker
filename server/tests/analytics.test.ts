import request from 'supertest';
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
