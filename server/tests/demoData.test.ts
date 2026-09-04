import { Types } from 'mongoose';
import request from 'supertest';
import { Application } from '@/models/Application';
import { buildDemoApplications, DEMO_APPLICATION_COUNT } from '@/services/demoData.service';
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
const DEMO_DATA = `${APPLICATIONS_BASE}/demo-data`;

const load = (token: string): request.Test =>
  request(app).post(DEMO_DATA).set('Authorization', `Bearer ${token}`);

/**
 * Counts straight off the collection rather than through the list endpoint,
 * which hides archived rows by default and would undercount the fixture set.
 */
const countFor = async (userId: string): Promise<number> =>
  Application.countDocuments({ user: new Types.ObjectId(userId) });

describe('POST /applications/demo-data', () => {
  it('requires authentication', async () => {
    const response = await request(app).post(DEMO_DATA);

    expect(response.status).toBe(401);
  });

  it('fills an empty account with the fixture set', async () => {
    const { accessToken, userId } = await registerUser(app);

    const response = await load(accessToken);

    expect(response.status).toBe(201);
    expect(response.body.data.inserted).toBe(DEMO_APPLICATION_COUNT);
    expect(await countFor(userId)).toBe(DEMO_APPLICATION_COUNT);
  });

  it('refuses an account that already has applications', async () => {
    const { accessToken, userId } = await registerUser(app);
    await createApplicationFor(app, accessToken);

    const response = await load(accessToken);

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('DEMO_DATA_NOT_EMPTY');
    // The refusal has to be total: a partial load would leave fixture rows
    // mixed into a real search with no way to tell them apart.
    expect(await countFor(userId)).toBe(1);
  });

  it('loads only into the account that asked for it', async () => {
    const first = await registerUser(app);
    const second = await registerUser(app);

    await load(first.accessToken);

    expect(await countFor(second.userId)).toBe(0);
  });
});

describe('demo data generator', () => {
  const userId = new Types.ObjectId();
  const now = new Date('2026-09-04T10:00:00.000Z');
  const MS_PER_DAY = 86_400_000;

  it('produces the same set for the same seed', () => {
    const first = buildDemoApplications(userId, now);
    const second = buildDemoApplications(userId, now);

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('spreads the rows over six months so the timeline has a shape', () => {
    const rows = buildDemoApplications(userId, now);
    const dates = rows.map((row) => (row.createdAt as Date).getTime());

    expect(rows).toHaveLength(DEMO_APPLICATION_COUNT);
    expect(Math.max(...dates)).toBeLessThanOrEqual(now.getTime());
    expect(now.getTime() - Math.min(...dates)).toBeLessThanOrEqual(183 * MS_PER_DAY);
    // A dashboard built on one week of rows would look broken however many there
    // are, so the spread itself is asserted, not just the count.
    expect(now.getTime() - Math.min(...dates)).toBeGreaterThan(120 * MS_PER_DAY);
  });

  it('populates every chart the dashboard renders', () => {
    const rows = buildDemoApplications(userId, now);
    const distinct = (key: string): number =>
      new Set(rows.map((row) => row[key]).filter(Boolean)).size;

    expect(distinct('status')).toBeGreaterThanOrEqual(5);
    expect(distinct('source')).toBeGreaterThanOrEqual(4);
    expect(distinct('company')).toBeGreaterThanOrEqual(10);
    expect(rows.filter((row) => (row.interviews as unknown[]).length > 0).length).toBeGreaterThan(
      5,
    );
    expect(rows.filter((row) => row.deadline !== undefined).length).toBeGreaterThan(10);
  });

  it('gives every row a status history that ends at its current status', () => {
    const rows = buildDemoApplications(userId, now);

    for (const row of rows) {
      const history = row.statusHistory as { from: string | null; to: string }[];

      expect(history.length).toBeGreaterThan(0);
      expect(history[0]).toMatchObject({ from: null, to: 'saved' });
      expect(history[history.length - 1].to).toBe(row.status);
    }
  });

  it('leaves an interview that has not happened yet pending', () => {
    const rows = buildDemoApplications(userId, now);
    const interviews = rows.flatMap(
      (row) => row.interviews as { scheduledAt: Date; outcome: string }[],
    );

    for (const interview of interviews) {
      if (interview.scheduledAt.getTime() >= now.getTime()) {
        expect(interview.outcome).toBe('pending');
      }
    }
  });
});
