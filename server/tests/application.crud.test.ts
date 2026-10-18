import request from 'supertest';
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

describe('applications CRUD', () => {
  it('requires authentication', async () => {
    const response = await request(app).get(APPLICATIONS_BASE);

    expect(response.status).toBe(401);
  });

  describe('POST /applications', () => {
    it('creates a record with the documented defaults', async () => {
      const { accessToken } = await registerUser(app);

      const response = await request(app)
        .post(APPLICATIONS_BASE)
        .set('Authorization', `Bearer ${accessToken}`)
        .send(buildApplicationPayload({ company: 'Grab', role: 'Backend Intern' }));

      expect(response.status).toBe(201);
      expect(response.body.data.application).toMatchObject({
        company: 'Grab',
        role: 'Backend Intern',
        status: 'saved',
        priority: 'medium',
        employmentType: 'internship',
        archived: false,
        schemaVersion: 1,
        version: 0,
        tags: [],
      });
      expect(response.body.data.application.id).toBeDefined();
      expect(response.body.data.application._id).toBeUndefined();
    });

    it('derives the company logo URL from the website domain', async () => {
      const { accessToken } = await registerUser(app);

      const created = await createApplicationFor(app, accessToken, {
        companyWebsite: 'https://www.grab.com/careers',
      });

      expect(created.application.companyLogoUrl).toBe('https://logo.clearbit.com/grab.com');
    });

    it('derives nextActionDate from an upcoming deadline', async () => {
      const { accessToken } = await registerUser(app);
      const deadline = new Date(Date.now() + 7 * 86_400_000);

      const created = await createApplicationFor(app, accessToken, {
        deadline: deadline.toISOString(),
      });

      expect(new Date(created.application.nextActionDate as string).getTime()).toBe(
        deadline.getTime(),
      );
    });

    // Issue #99: a date-only deadline is the whole day it names, so today's still counts.
    it('keeps a date-only deadline for today as the next action', async () => {
      const { accessToken } = await registerUser(app);
      const today = `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`;

      const created = await createApplicationFor(app, accessToken, { deadline: today });

      expect(created.application.nextActionDate).toBe(today);
    });

    it('leaves nextActionDate unset when the deadline has passed', async () => {
      const { accessToken } = await registerUser(app);

      const created = await createApplicationFor(app, accessToken, {
        deadline: new Date(Date.now() - 86_400_000).toISOString(),
      });

      expect(created.application.nextActionDate).toBeUndefined();
    });

    it('rejects server-derived fields rather than silently dropping them', async () => {
      const { accessToken } = await registerUser(app);

      const response = await request(app)
        .post(APPLICATIONS_BASE)
        .set('Authorization', `Bearer ${accessToken}`)
        .send(buildApplicationPayload({ companyLogoUrl: 'https://evil.example.com/logo.png' }));

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });

    it.each([
      ['a missing company', { company: undefined }],
      ['a malformed job URL', { jobUrl: 'not-a-url' }],
      ['an unknown status', { status: 'ghosted_maybe' }],
      ['an unknown source', { source: 'carrier_pigeon' }],
      [
        'a currency that is not three letters',
        { stipend: { amount: 1, currency: 'RINGGIT', period: 'month' } },
      ],
    ])('rejects %s', async (_label, overrides) => {
      const { accessToken } = await registerUser(app);
      const payload = buildApplicationPayload(overrides as Record<string, unknown>);
      if (
        (overrides as { company?: unknown }).company === undefined &&
        'company' in (overrides as object)
      ) {
        delete payload.company;
      }

      const response = await request(app)
        .post(APPLICATIONS_BASE)
        .set('Authorization', `Bearer ${accessToken}`)
        .send(payload);

      expect(response.status).toBe(400);
    });
  });

  describe('GET, PATCH and DELETE /applications/:id', () => {
    it('reads back a created record', async () => {
      const { accessToken } = await registerUser(app);
      const created = await createApplicationFor(app, accessToken, { company: 'Shopee' });

      const response = await request(app)
        .get(`${APPLICATIONS_BASE}/${created.id}`)
        .set('Authorization', `Bearer ${accessToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data.application.company).toBe('Shopee');
    });

    it('updates fields and recomputes the derived logo URL', async () => {
      const { accessToken } = await registerUser(app);
      const created = await createApplicationFor(app, accessToken);

      const response = await request(app)
        .patch(`${APPLICATIONS_BASE}/${created.id}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ location: 'Kuala Lumpur', companyWebsite: 'https://shopee.com' });

      expect(response.status).toBe(200);
      expect(response.body.data.application.location).toBe('Kuala Lumpur');
      expect(response.body.data.application.companyLogoUrl).toBe(
        'https://logo.clearbit.com/shopee.com',
      );
    });

    it('rejects an empty patch', async () => {
      const { accessToken } = await registerUser(app);
      const created = await createApplicationFor(app, accessToken);

      const response = await request(app)
        .patch(`${APPLICATIONS_BASE}/${created.id}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({});

      expect(response.status).toBe(400);
    });

    it('deletes a record and then reports it missing', async () => {
      const { accessToken } = await registerUser(app);
      const created = await createApplicationFor(app, accessToken);

      const deleted = await request(app)
        .delete(`${APPLICATIONS_BASE}/${created.id}`)
        .set('Authorization', `Bearer ${accessToken}`);
      const afterDelete = await request(app)
        .get(`${APPLICATIONS_BASE}/${created.id}`)
        .set('Authorization', `Bearer ${accessToken}`);

      expect(deleted.status).toBe(200);
      expect(afterDelete.status).toBe(404);
    });

    it('rejects a malformed id with 400 rather than a cast error', async () => {
      const { accessToken } = await registerUser(app);

      const response = await request(app)
        .get(`${APPLICATIONS_BASE}/not-an-object-id`)
        .set('Authorization', `Bearer ${accessToken}`);

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });
  });
});
