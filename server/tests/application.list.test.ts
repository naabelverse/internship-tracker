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

interface Seeded {
  token: string;
}

/** Builds a small, deliberately varied set so each filter has something to bite on. */
async function seed(): Promise<Seeded> {
  const { accessToken } = await registerUser(app);

  await createApplicationFor(app, accessToken, {
    company: 'Grab',
    role: 'Backend Intern',
    status: 'applied',
    source: 'linkedin',
    workMode: 'remote',
    priority: 'high',
    tags: ['golang', 'fintech'],
  });
  await createApplicationFor(app, accessToken, {
    company: 'Shopee',
    role: 'Frontend Intern',
    status: 'interview',
    source: 'referral',
    workMode: 'hybrid',
    priority: 'medium',
    tags: ['react'],
  });
  await createApplicationFor(app, accessToken, {
    company: 'Airasia',
    role: 'Data Intern',
    status: 'rejected',
    source: 'company_site',
    workMode: 'onsite',
    priority: 'low',
    tags: ['python'],
  });
  await createApplicationFor(app, accessToken, {
    company: 'Archived Co',
    role: 'Old Intern',
    status: 'withdrawn',
    archived: true,
  });

  return { token: accessToken };
}

const list = (token: string, query = ''): request.Test =>
  request(app).get(`${APPLICATIONS_BASE}${query}`).set('Authorization', `Bearer ${token}`);

const companiesIn = (response: request.Response): string[] =>
  (response.body.data.applications as { company: string }[]).map((entry) => entry.company);

describe('GET /applications', () => {
  describe('pagination', () => {
    it('returns the documented meta block', async () => {
      const { token } = await seed();

      const response = await list(token, '?limit=2');

      expect(response.status).toBe(200);
      expect(response.body.meta).toEqual({ total: 3, page: 1, limit: 2, totalPages: 2 });
      expect(response.body.data.applications).toHaveLength(2);
    });

    it('serves the second page', async () => {
      const { token } = await seed();

      const response = await list(token, '?limit=2&page=2');

      expect(response.body.data.applications).toHaveLength(1);
      expect(response.body.meta.page).toBe(2);
    });

    it('rejects a limit above the cap', async () => {
      const { token } = await seed();

      const response = await list(token, '?limit=500');

      expect(response.status).toBe(400);
    });
  });

  describe('sorting', () => {
    it('sorts by company ascending and descending', async () => {
      const { token } = await seed();

      const ascending = await list(token, '?sort=company:asc');
      const descending = await list(token, '?sort=company:desc');

      expect(companiesIn(ascending)).toEqual(['Airasia', 'Grab', 'Shopee']);
      expect(companiesIn(descending)).toEqual(['Shopee', 'Grab', 'Airasia']);
    });

    it('rejects an unsortable field', async () => {
      const { token } = await seed();

      const response = await list(token, '?sort=password:asc');

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('filtering', () => {
    it('filters by repeated status keys', async () => {
      const { token } = await seed();

      const response = await list(token, '?status=applied&status=interview&sort=company:asc');

      expect(companiesIn(response)).toEqual(['Grab', 'Shopee']);
    });

    it('accepts a comma separated list for the same filter', async () => {
      const { token } = await seed();

      const response = await list(token, '?status=applied,interview&sort=company:asc');

      expect(companiesIn(response)).toEqual(['Grab', 'Shopee']);
    });

    it.each([
      ['?source=referral', ['Shopee']],
      ['?workMode=onsite', ['Airasia']],
      ['?priority=high', ['Grab']],
      ['?tags=react', ['Shopee']],
      ['?company=grab', ['Grab']],
    ])('filters with %s', async (query, expected) => {
      const { token } = await seed();

      const response = await list(token, query);

      expect(companiesIn(response)).toEqual(expected);
    });

    it('matches any of several tags', async () => {
      const { token } = await seed();

      const response = await list(token, '?tags=react,python&sort=company:asc');

      expect(companiesIn(response)).toEqual(['Airasia', 'Shopee']);
    });
  });
});

describe('GET /applications search and archive behaviour', () => {
  it('matches a partial company or role, case insensitively', async () => {
    const { token } = await seed();

    const byCompany = await list(token, '?search=shop');
    const byRole = await list(token, '?search=BACKEND');

    expect(companiesIn(byCompany)).toEqual(['Shopee']);
    expect(companiesIn(byRole)).toEqual(['Grab']);
  });

  it('treats regular expression metacharacters as literal text', async () => {
    const { accessToken } = await registerUser(app);
    await createApplicationFor(app, accessToken, { company: 'A.C.M.E', role: 'Intern' });
    await createApplicationFor(app, accessToken, { company: 'ABCME', role: 'Intern' });

    const response = await list(accessToken, '?search=A.C.M');

    // An unescaped `.` would also match ABCME, so a single hit proves escaping.
    expect(companiesIn(response)).toEqual(['A.C.M.E']);
  });

  it('survives a search term built only from metacharacters', async () => {
    const { token } = await seed();

    const response = await list(token, `?search=${encodeURIComponent('.*+?[](){}')}`);

    expect(response.status).toBe(200);
    expect(response.body.data.applications).toHaveLength(0);
  });

  it('hides archived records by default and shows only those when asked', async () => {
    const { token } = await seed();

    const byDefault = await list(token);
    const archivedOnly = await list(token, '?archived=true');

    expect(companiesIn(byDefault)).not.toContain('Archived Co');
    expect(byDefault.body.meta.total).toBe(3);
    expect(companiesIn(archivedOnly)).toEqual(['Archived Co']);
  });

  it('filters on a created date range', async () => {
    const { token } = await seed();

    const inRange = await list(
      token,
      `?dateFrom=${new Date(Date.now() - 86_400_000).toISOString()}`,
    );
    const outOfRange = await list(
      token,
      `?dateTo=${new Date(Date.now() - 86_400_000).toISOString()}`,
    );

    expect(inRange.body.meta.total).toBe(3);
    expect(outOfRange.body.meta.total).toBe(0);
  });

  it('rejects an unknown query parameter rather than ignoring it', async () => {
    const { token } = await seed();

    const response = await list(token, '?unknownFilter=1');

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');
  });

  it('returns an empty page with honest meta when nothing matches', async () => {
    const { token } = await seed();

    const response = await list(token, '?status=offer');

    expect(response.body.data.applications).toEqual([]);
    expect(response.body.meta).toEqual({ total: 0, page: 1, limit: 20, totalPages: 0 });
  });
});
