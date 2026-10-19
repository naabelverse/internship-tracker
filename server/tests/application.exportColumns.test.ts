import Papa from 'papaparse';
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

/**
 * The "Shown columns" choice on the applications toolbar: `columns` on the CSV
 * export picks table columns from a fixed list, and the file carries only the
 * fields those columns map to. Without it the export is the full file, exactly
 * as it was before the option existed.
 */

const FULL_HEADER =
  'company,role,status,priority,source,sourceOther,workMode,employmentType,location,jobUrl,' +
  'companyWebsite,appliedDate,deadline,tags,notes,resumeVersion,stipendAmount,' +
  'stipendCurrency,stipendPeriod,contactName,contactEmail,archived,createdAt';

const exportCsv = (token: string, query: string): request.Test =>
  request(app).get(`${APPLICATIONS_BASE}/export?${query}`).set('Authorization', `Bearer ${token}`);

function parse(csv: string): { header: string[]; rows: Record<string, string>[] } {
  const parsed = Papa.parse<Record<string, string>>(csv, { header: true });
  return { header: parsed.meta.fields ?? [], rows: parsed.data };
}

/** An account whose rows exercise quoting, "Other" text and formula-like values. */
async function seededAccount(): Promise<string> {
  const { accessToken } = await registerUser(app);
  await createApplicationFor(app, accessToken, {
    company: 'Career Fair Co',
    source: 'other',
    sourceOther: 'Career fair, KL',
    tags: ['fair', 'ops'],
    appliedDate: '2026-09-01',
  });
  await createApplicationFor(app, accessToken, {
    company: '=1+1',
    role: '+cmd',
    location: '@home',
    tags: ['-2+3'],
  });
  await createApplicationFor(app, accessToken, {
    company: 'Quote "Co", Ltd',
    status: 'interview',
    archived: true,
  });
  return accessToken;
}

describe('GET /applications/export with columns', () => {
  it('without columns, still exports every field in the original order', async () => {
    const token = await seededAccount();

    const response = await exportCsv(token, 'format=csv');

    expect(response.status).toBe(200);
    expect(response.text.split(/\r?\n/)[0]).toBe(FULL_HEADER);
    // The archived row is hidden, as it is in the list without archived=true (#83).
    expect(parse(response.text).rows).toHaveLength(2);
  });

  // Issue #83: the file carries the rows the list shows for the same query.
  it.each([
    ['the default view', 'format=csv', ['=1+1', 'Career Fair Co']],
    ['a search', 'format=csv&search=career', ['Career Fair Co']],
    ['a status filter', 'format=csv&status=interview&archived=true', ['Quote "Co", Ltd']],
    ['Show archived', 'format=csv&archived=true', ['Quote "Co", Ltd']],
    ['a sort', 'format=csv&sort=company:asc', ['=1+1', 'Career Fair Co']],
  ])('follows %s, on both choices', async (_case, query, companies) => {
    const token = await seededAccount();

    const full = parse((await exportCsv(token, query)).text);
    const shown = parse((await exportCsv(token, `${query}&columns=company,status`)).text);

    // The stored company, without the formula guard #82 puts on "=1+1".
    const stored = (row: Record<string, string>): string => row.company.replace(/^'/, '');
    expect(full.rows.map(stored)).toEqual(companies);
    expect(shown.rows.map(stored)).toEqual(companies);
  });

  it('exports only the requested columns', async () => {
    const token = await seededAccount();

    const response = await exportCsv(token, 'format=csv&columns=company,status');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.headers['content-disposition']).toContain('attachment');
    expect(response.text.split(/\r?\n/)[0]).toBe('company,status');
  });

  it('accepts every table column, and Source brings sourceOther with it', async () => {
    const token = await seededAccount();

    const response = await exportCsv(
      token,
      'format=csv&columns=company,role,status,priority,source,location,appliedDate,deadline,tags',
    );

    expect(response.status).toBe(200);
    expect(response.text.split(/\r?\n/)[0]).toBe(
      'company,role,status,priority,source,sourceOther,location,appliedDate,deadline,tags',
    );
    const career = parse(response.text).rows.find((row) => row.company === 'Career Fair Co');
    expect(career).toMatchObject({ source: 'other', sourceOther: 'Career fair, KL' });
  });

  it('writes the columns in the full export order, whatever order they were asked in', async () => {
    const token = await seededAccount();

    const response = await exportCsv(token, 'columns=tags,deadline,source,company');

    expect(response.status).toBe(200);
    expect(response.text.split(/\r?\n/)[0]).toBe('company,source,sourceOther,deadline,tags');
  });

  it('keeps the row set and every cell value of the full export', async () => {
    const token = await seededAccount();

    const full = parse((await exportCsv(token, 'format=csv')).text);
    const shown = parse(
      (await exportCsv(token, 'format=csv&columns=company,role,location,tags')).text,
    );

    expect(shown.header).toEqual(['company', 'role', 'location', 'tags']);
    expect(shown.rows).toEqual(
      full.rows.map((row) => ({
        company: row.company,
        role: row.role,
        location: row.location,
        tags: row.tags,
      })),
    );
  });

  // Issue #82: a spreadsheet runs a cell starting with =, +, - or @ as a formula.
  // Both choices go through the same serialiser, so both escape identically.
  it('escapes formula-like values the same way on both paths (#82)', async () => {
    const token = await seededAccount();

    const full = await exportCsv(token, 'format=csv');
    const shown = await exportCsv(token, 'format=csv&columns=company,role,location,tags');

    const fullRow = full.text.split(/\r?\n/).find((line) => line.startsWith("'=1+1"));
    const shownRow = shown.text.split(/\r?\n/).find((line) => line.startsWith("'=1+1"));
    expect(shownRow).toBe("'=1+1,'+cmd,'@home,'-2+3");
    expect(fullRow?.startsWith("'=1+1,'+cmd,")).toBe(true);
  });

  it.each([
    ['an unknown column', 'columns=company,notes', 'unknown column "notes"'],
    ['a field with no table column', 'columns=jobUrl', 'unknown column "jobUrl"'],
    ['an empty list', 'columns=', 'unknown column ""'],
    ['a trailing comma', 'columns=company,', 'unknown column ""'],
    ['columns on the JSON format', 'format=json&columns=company', 'only to the csv format'],
  ])('rejects %s with a 400 that names the columns parameter', async (_case, query, message) => {
    const token = await seededAccount();

    const response = await exportCsv(token, query);

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');
    expect(response.body.errors.columns.join(' ')).toContain(message);
  });

  it('lists the allowed columns when it rejects one', async () => {
    const token = await seededAccount();

    const response = await exportCsv(token, 'columns=notes');

    expect(response.body.errors.columns[0]).toContain(
      'expected any of company, role, status, priority, source, location, appliedDate, deadline, tags',
    );
  });

  it('round trips a full export with every field back through import', async () => {
    const { accessToken } = await registerUser(app);
    await createApplicationFor(app, accessToken, {
      company: 'Setel',
      role: 'Backend Intern',
      status: 'interview',
      priority: 'high',
      source: 'other',
      sourceOther: 'Career fair',
      workMode: 'hybrid',
      employmentType: 'part-time',
      location: 'Kuala Lumpur',
      jobUrl: 'https://example.com/jobs/1',
      companyWebsite: 'https://example.com',
      appliedDate: '2026-09-01',
      deadline: '2026-10-20',
      tags: ['sql', 'remote'],
      notes: 'Line one, with a comma',
      resumeVersion: 'v3',
      stipend: { amount: 2500, currency: 'MYR', period: 'month' },
      contact: { name: 'Wei Ling', email: 'hiring@example.com' },
      archived: true,
    });
    // Archived, so it is exported from the archived view, as "Show archived" would (#83).
    const exported = await exportCsv(accessToken, 'format=csv&archived=true');

    const second = await registerUser(app);
    const imported = await request(app)
      .post(`${APPLICATIONS_BASE}/import`)
      .set('Authorization', `Bearer ${second.accessToken}`)
      .attach('file', Buffer.from(exported.text, 'utf8'), {
        filename: 'apps.csv',
        contentType: 'text/csv',
      });

    expect(imported.body.data).toMatchObject({ imported: 1, skipped: 0, errors: [] });
    const stored = await Application.findOne({ user: second.userId }).lean();
    expect(stored).toMatchObject({
      company: 'Setel',
      role: 'Backend Intern',
      status: 'interview',
      priority: 'high',
      source: 'other',
      sourceOther: 'Career fair',
      workMode: 'hybrid',
      employmentType: 'part-time',
      location: 'Kuala Lumpur',
      jobUrl: 'https://example.com/jobs/1',
      companyWebsite: 'https://example.com',
      tags: ['sql', 'remote'],
      notes: 'Line one, with a comma',
      resumeVersion: 'v3',
      stipend: { amount: 2500, currency: 'MYR', period: 'month' },
      contact: { name: 'Wei Ling', email: 'hiring@example.com' },
      archived: true,
    });
    expect(stored?.appliedDate?.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(stored?.deadline?.toISOString()).toBe('2026-10-20T00:00:00.000Z');
  });
});
