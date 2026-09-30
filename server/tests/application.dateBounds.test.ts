import request from 'supertest';
import { Application } from '@/models/Application';
import {
  APPLICATIONS_BASE,
  buildApplicationPayload,
  buildTestApp,
  createApplicationFor,
  registerUser,
  useCleanAuthRateLimits,
} from './helpers/factories';
import { useTestDatabase } from './helpers/testDb';

useTestDatabase();
useCleanAuthRateLimits();

const app = buildTestApp();

/**
 * Dates used to be `z.coerce.date()` and nothing else, so anything `new Date`
 * could read was stored: a signed six-digit year, a US-style string with one,
 * year 26, and an ISO day that does not exist (rolled into the next month).
 * The client form sent `111111-11-11T00:00:00.000Z`, which was only refused
 * because an unsigned year past 9999 happens not to parse.
 */
const OUT_OF_RANGE = [
  '+111111-11-11T00:00:00.000Z',
  '11/11/111111',
  '0026-01-01T00:00:00.000Z',
  '1999-12-31T00:00:00.000Z',
  '2100-01-01T00:00:00.000Z',
  '9999-12-31T00:00:00.000Z',
];

const createWith = (token: string, overrides: Record<string, unknown>): request.Test =>
  request(app)
    .post(APPLICATIONS_BASE)
    .set('Authorization', `Bearer ${token}`)
    .send(buildApplicationPayload(overrides));

describe('application date bounds', () => {
  it.each(OUT_OF_RANGE)('rejects an applied date or deadline of %s', async (value) => {
    const { accessToken } = await registerUser(app);

    for (const field of ['appliedDate', 'deadline']) {
      const response = await createWith(accessToken, { [field]: value });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
      expect(response.body.errors[field]).toEqual(['must be between 2000 and 2099']);
    }

    expect(await Application.countDocuments({})).toBe(0);
  });

  it('rejects a day that does not exist instead of rolling it over', async () => {
    const { accessToken } = await registerUser(app);

    const response = await createWith(accessToken, { deadline: '2026-02-30T00:00:00.000Z' });

    expect(response.status).toBe(400);
    expect(response.body.errors.deadline).toEqual(['must be a real calendar date']);
  });

  it('still reports an unparseable string as an invalid date', async () => {
    const { accessToken } = await registerUser(app);

    const response = await createWith(accessToken, { appliedDate: 'next tuesday' });

    expect(response.status).toBe(400);
    expect(response.body.errors.appliedDate).toBeDefined();
  });

  it('accepts both boundary days and an ordinary date', async () => {
    const { accessToken } = await registerUser(app);

    const created = await createApplicationFor(app, accessToken, {
      appliedDate: '2000-01-01T00:00:00.000Z',
      deadline: '2099-12-31T00:00:00.000Z',
    });
    const ordinary = await createApplicationFor(app, accessToken, {
      deadline: '2026-10-15T00:00:00.000Z',
    });

    expect(created.application.appliedDate).toBe('2000-01-01T00:00:00.000Z');
    expect(created.application.deadline).toBe('2099-12-31T00:00:00.000Z');
    expect(ordinary.application.deadline).toBe('2026-10-15T00:00:00.000Z');
  });

  it('applies the same bounds to an update', async () => {
    const { accessToken } = await registerUser(app);
    const created = await createApplicationFor(app, accessToken, {
      deadline: '2026-10-15T00:00:00.000Z',
    });

    const response = await request(app)
      .patch(`${APPLICATIONS_BASE}/${created.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ deadline: '+111111-11-11T00:00:00.000Z' });

    expect(response.status).toBe(400);
    const stored = await Application.findById(created.id);
    expect(stored?.deadline?.toISOString()).toBe('2026-10-15T00:00:00.000Z');
  });

  it('applies the same bounds to an interview', async () => {
    const { accessToken } = await registerUser(app);
    const created = await createApplicationFor(app, accessToken);
    const addInterview = (scheduledAt: string): request.Test =>
      request(app)
        .post(`${APPLICATIONS_BASE}/${created.id}/interviews`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ type: 'technical', mode: 'video', scheduledAt });

    const rejected = await addInterview('+111111-11-11T10:00:00.000Z');
    const accepted = await addInterview('2026-11-02T02:00:00.000Z');

    expect(rejected.status).toBe(400);
    expect(rejected.body.errors.scheduledAt).toEqual(['must be between 2000 and 2099']);
    expect(accepted.status).toBe(201);
  });

  it('skips an imported row with an out-of-range deadline and names the field', async () => {
    const { accessToken } = await registerUser(app);
    const csv = [
      'company,role,deadline',
      'Grab,Backend Intern,2026-12-01',
      'Shopee,Frontend Intern,+111111-11-11',
      'Sea,Data Intern,0026-01-01',
    ].join('\n');

    const response = await request(app)
      .post(`${APPLICATIONS_BASE}/import`)
      .set('Authorization', `Bearer ${accessToken}`)
      .attach('file', Buffer.from(csv, 'utf8'), { filename: 'apps.csv', contentType: 'text/csv' });

    expect(response.body.data).toMatchObject({ imported: 1, skipped: 2 });
    expect(response.body.data.errors).toEqual([
      expect.objectContaining({ row: 3, field: 'deadline' }),
      expect.objectContaining({ row: 4, field: 'deadline' }),
    ]);
  });
});
