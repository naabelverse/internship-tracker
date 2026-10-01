import request from 'supertest';
import { Types } from 'mongoose';
import { Application, SOURCES } from '@/models/Application';
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

const patch = (token: string, id: string, body: Record<string, unknown>): request.Test =>
  request(app)
    .patch(`${APPLICATIONS_BASE}/${id}`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);

/** Writes a retired value straight to the collection, as an older release would have. */
async function storeLegacySource(id: string): Promise<void> {
  await Application.collection.updateOne(
    { _id: new Types.ObjectId(id) },
    { $set: { source: 'internshala' } },
  );
}

describe('source and the "Other: please specify" text', () => {
  it('accepts each of the new Malaysian sources', async () => {
    const { accessToken } = await registerUser(app);

    for (const source of ['jobstreet', 'hiredly', 'maukerja', 'myfuturejobs']) {
      const { application } = await createApplicationFor(app, accessToken, { source });
      expect(application.source).toBe(source);
    }
  });

  it('rejects a retired source on write', async () => {
    const { accessToken } = await registerUser(app);

    const response = await request(app)
      .post(APPLICATIONS_BASE)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ company: 'Grab', role: 'Intern', source: 'internshala' });

    expect(response.status).toBe(400);
  });

  it('stores the specify text alongside other', async () => {
    const { accessToken } = await registerUser(app);

    const { application } = await createApplicationFor(app, accessToken, {
      source: 'other',
      sourceOther: '  Glints  ',
    });

    expect(application.source).toBe('other');
    expect(application.sourceOther).toBe('Glints');
  });

  it('accepts other without the text, since only the form requires it', async () => {
    const { accessToken } = await registerUser(app);

    const { application } = await createApplicationFor(app, accessToken, { source: 'other' });

    expect(application.source).toBe('other');
    expect(application.sourceOther).toBeUndefined();
  });

  it('drops the text when the source is not other', async () => {
    const { accessToken } = await registerUser(app);

    const { application } = await createApplicationFor(app, accessToken, {
      source: 'linkedin',
      sourceOther: 'Glints',
    });

    expect(application.sourceOther).toBeUndefined();
  });

  it('clears the text when an application moves off other', async () => {
    const { accessToken } = await registerUser(app);
    const { id } = await createApplicationFor(app, accessToken, {
      source: 'other',
      sourceOther: 'Glints',
    });

    const response = await patch(accessToken, id, { source: 'jobstreet' });

    expect(response.status).toBe(200);
    expect(response.body.data.application.source).toBe('jobstreet');
    expect(response.body.data.application.sourceOther).toBeUndefined();
    expect((await Application.findById(id))?.sourceOther).toBeUndefined();
  });

  it('rejects text over the length cap', async () => {
    const { accessToken } = await registerUser(app);
    const { id } = await createApplicationFor(app, accessToken, { source: 'other' });

    const response = await patch(accessToken, id, { sourceOther: 'x'.repeat(61) });

    expect(response.status).toBe(400);
  });

  it('filters other as one group, whatever each row says it was', async () => {
    const { accessToken } = await registerUser(app);
    await createApplicationFor(app, accessToken, { source: 'other', sourceOther: 'Glints' });
    await createApplicationFor(app, accessToken, { source: 'other', sourceOther: 'Instagram' });
    await createApplicationFor(app, accessToken, { source: 'linkedin' });

    const response = await request(app)
      .get(`${APPLICATIONS_BASE}?source=other`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(response.body.data.applications).toHaveLength(2);
  });
});

describe('the model', () => {
  it('rejects internshala outright', async () => {
    const application = new Application({
      user: new Types.ObjectId(),
      company: 'Grab',
      role: 'Intern',
      source: 'internshala',
    });

    await expect(application.validate()).rejects.toThrow(/source/);
  });

  it('accepts exactly the current list, with no retired value kept for compatibility', () => {
    const enumValues = (Application.schema.path('source') as unknown as { enumValues: string[] })
      .enumValues;

    expect(enumValues).toEqual([...SOURCES]);
    expect(enumValues).not.toContain('internshala');
  });
});

describe('a row still holding a retired source', () => {
  it('reads back as stored', async () => {
    const { accessToken } = await registerUser(app);
    const { id } = await createApplicationFor(app, accessToken);
    await storeLegacySource(id);

    const response = await request(app)
      .get(`${APPLICATIONS_BASE}/${id}`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.application.source).toBe('internshala');
  });

  // Every save re-validates the paths it loaded, so a row migration 002 has not
  // reached cannot be saved at all. This is the failure that makes the migration
  // a hard prerequisite of the deploy rather than a tidy-up after it.
  it('fails its next save, which is why migration 002 must run before the deploy', async () => {
    const { accessToken } = await registerUser(app);
    const { id } = await createApplicationFor(app, accessToken);
    await storeLegacySource(id);

    const status = await request(app)
      .patch(`${APPLICATIONS_BASE}/${id}/status`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ status: 'applied' });
    expect(status.status).toBe(400);

    const edit = await patch(accessToken, id, { priority: 'high' });
    expect(edit.status).toBe(400);

    const stored = await Application.collection.findOne({ _id: new Types.ObjectId(id) });
    expect(stored?.source).toBe('internshala');
    expect(stored?.status).not.toBe('applied');
  });

  it('moves onto the current shape when the form saves it as other', async () => {
    const { accessToken } = await registerUser(app);
    const { id } = await createApplicationFor(app, accessToken);
    await storeLegacySource(id);

    const response = await patch(accessToken, id, { source: 'other', sourceOther: 'internshala' });

    expect(response.status).toBe(200);
    expect(response.body.data.application.source).toBe('other');
    expect(response.body.data.application.sourceOther).toBe('internshala');
  });
});

describe('CSV round trip', () => {
  const importCsv = (token: string, csv: string): request.Test =>
    request(app)
      .post(`${APPLICATIONS_BASE}/import`)
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from(csv, 'utf8'), { filename: 'apps.csv', contentType: 'text/csv' });

  it('exports the specify text in its own column, next to source', async () => {
    const { accessToken } = await registerUser(app);
    await createApplicationFor(app, accessToken, {
      company: 'Grab',
      source: 'other',
      sourceOther: 'Glints',
    });

    const response = await request(app)
      .get(`${APPLICATIONS_BASE}/export?format=csv`)
      .set('Authorization', `Bearer ${accessToken}`);

    const [header, row] = response.text.split('\n');
    const columns = header.split(',');
    const cells = row.split(',');
    expect(columns.indexOf('sourceOther')).toBe(columns.indexOf('source') + 1);
    expect(cells[columns.indexOf('source')]).toBe('other');
    expect(cells[columns.indexOf('sourceOther')]).toBe('Glints');
  });

  it('imports a new source and an other with its text', async () => {
    const { accessToken, userId } = await registerUser(app);
    const csv = [
      'company,role,source,sourceOther',
      'Grab,Intern,jobstreet,',
      'Shopee,Intern,other,University career portal',
    ].join('\n');

    const response = await importCsv(accessToken, csv);

    expect(response.status).toBe(200);
    expect(response.body.data.imported).toBe(2);
    const rows = await Application.find({ user: userId }).sort({ company: 1 }).lean();
    expect(rows.map((row) => [row.company, row.source, row.sourceOther])).toEqual([
      ['Grab', 'jobstreet', undefined],
      ['Shopee', 'other', 'University career portal'],
    ]);
  });

  it('reads a retired source from an old export as other, keeping the name', async () => {
    const { accessToken, userId } = await registerUser(app);

    const response = await importCsv(accessToken, 'company,role,source\nGrab,Intern,internshala');

    expect(response.body.data.imported).toBe(1);
    const row = await Application.findOne({ user: userId }).lean();
    expect(row?.source).toBe('other');
    expect(row?.sourceOther).toBe('Internshala');
  });
});
