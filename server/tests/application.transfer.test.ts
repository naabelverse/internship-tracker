import request from 'supertest';
import { Application } from '@/models/Application';
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

const HEADER = 'company,role,status,priority,source,tags,deadline';

const importCsv = (token: string, csv: string): request.Test =>
  request(app)
    .post(`${APPLICATIONS_BASE}/import`)
    .set('Authorization', `Bearer ${token}`)
    .attach('file', Buffer.from(csv, 'utf8'), { filename: 'apps.csv', contentType: 'text/csv' });

describe('GET /applications/export', () => {
  it('returns CSV with a stable header row and an attachment disposition', async () => {
    const { accessToken } = await registerUser(app);
    await createApplicationFor(app, accessToken, { company: 'Grab', role: 'Backend Intern' });

    const response = await request(app)
      .get(`${APPLICATIONS_BASE}/export?format=csv`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.headers['content-disposition']).toContain('attachment');

    const [header, firstRow] = response.text.split('\n');
    expect(header).toContain('company');
    expect(header).toContain('role');
    expect(header).toContain('status');
    expect(firstRow).toContain('Grab');
  });

  it('quotes a value containing a comma so the column count is preserved', async () => {
    const { accessToken } = await registerUser(app);
    await createApplicationFor(app, accessToken, {
      company: 'Alpha, Beta and Co',
      role: 'Intern',
    });

    const response = await request(app)
      .get(`${APPLICATIONS_BASE}/export?format=csv`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(response.text).toContain('"Alpha, Beta and Co"');
  });

  it('returns JSON when asked', async () => {
    const { accessToken } = await registerUser(app);
    await createApplicationFor(app, accessToken, { company: 'Shopee' });

    const response = await request(app)
      .get(`${APPLICATIONS_BASE}/export?format=json`)
      .set('Authorization', `Bearer ${accessToken}`);

    const parsed = JSON.parse(response.text) as { company: string }[];
    expect(parsed).toHaveLength(1);
    expect(parsed[0].company).toBe('Shopee');
  });

  it('rejects an unknown format', async () => {
    const { accessToken } = await registerUser(app);

    const response = await request(app)
      .get(`${APPLICATIONS_BASE}/export?format=pdf`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(response.status).toBe(400);
  });
});

describe('POST /applications/import', () => {
  it('imports every valid row', async () => {
    const { accessToken } = await registerUser(app);
    const csv = [
      HEADER,
      'Grab,Backend Intern,applied,high,linkedin,golang;fintech,2026-12-01',
      'Shopee,Frontend Intern,saved,medium,referral,react,',
    ].join('\n');

    const response = await importCsv(accessToken, csv);

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ imported: 2, skipped: 0 });
    expect(response.body.data.errors).toEqual([]);

    const stored = await Application.find({}).sort({ company: 1 });
    expect(stored.map((entry) => entry.company)).toEqual(['Grab', 'Shopee']);
    expect(stored[0].tags).toEqual(['golang', 'fintech']);
    expect(stored[0].statusHistory).toHaveLength(1);
  });

  it('imports the good rows and explains each skipped one by field', async () => {
    const { accessToken } = await registerUser(app);
    const csv = [
      HEADER,
      'Grab,Backend Intern,applied,high,linkedin,golang,',
      ',No Company Intern,applied,high,linkedin,,',
      'Shopee,Frontend Intern,teleported,high,linkedin,,',
    ].join('\n');

    const response = await importCsv(accessToken, csv);

    expect(response.body.data.imported).toBe(1);
    expect(response.body.data.skipped).toBe(2);

    const errors = response.body.data.errors as { row: number; field: string; message: string }[];
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ row: 3, field: 'company' }),
        expect.objectContaining({ row: 4, field: 'status' }),
      ]),
    );
    // Every error names the offending column, not just the row.
    expect(
      errors.every((entry) => typeof entry.message === 'string' && entry.message.length > 0),
    ).toBe(true);
  });

  it('round trips an export back through import', async () => {
    const { accessToken } = await registerUser(app);
    await createApplicationFor(app, accessToken, {
      company: 'Alpha, Beta and Co',
      role: 'Data Intern',
      status: 'applied',
      tags: ['sql'],
    });

    const exported = await request(app)
      .get(`${APPLICATIONS_BASE}/export?format=csv`)
      .set('Authorization', `Bearer ${accessToken}`);

    const second = await registerUser(app);
    const response = await importCsv(second.accessToken, exported.text);

    expect(response.body.data.imported).toBe(1);
    const stored = await Application.findOne({ user: second.userId });
    expect(stored?.company).toBe('Alpha, Beta and Co');
    expect(stored?.tags).toEqual(['sql']);
  });

  it('rejects a request with no file', async () => {
    const { accessToken } = await registerUser(app);

    const response = await request(app)
      .post(`${APPLICATIONS_BASE}/import`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('FILE_REQUIRED');
  });

  it('rejects a CSV with a header but no rows', async () => {
    const { accessToken } = await registerUser(app);

    const response = await importCsv(accessToken, HEADER);

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('EMPTY_CSV');
  });
});
