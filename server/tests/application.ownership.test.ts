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

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

/**
 * Every assertion here expects 404 rather than 403. A 403 would confirm the row
 * exists, which leaks the existence of another account and its data.
 */
describe('ownership isolation between two accounts', () => {
  it('hides another account application from every single-record route', async () => {
    const alice = await registerUser(app);
    const bob = await registerUser(app);
    const aliceApplication = await createApplicationFor(app, alice.accessToken, {
      company: 'Alice Only Ltd',
    });

    const readAttempt = await request(app)
      .get(`${APPLICATIONS_BASE}/${aliceApplication.id}`)
      .set(auth(bob.accessToken));
    const patchAttempt = await request(app)
      .patch(`${APPLICATIONS_BASE}/${aliceApplication.id}`)
      .set(auth(bob.accessToken))
      .send({ company: 'Hijacked' });
    const statusAttempt = await request(app)
      .patch(`${APPLICATIONS_BASE}/${aliceApplication.id}/status`)
      .set(auth(bob.accessToken))
      .send({ status: 'offer' });
    const deleteAttempt = await request(app)
      .delete(`${APPLICATIONS_BASE}/${aliceApplication.id}`)
      .set(auth(bob.accessToken));

    for (const response of [readAttempt, patchAttempt, statusAttempt, deleteAttempt]) {
      expect(response.status).toBe(404);
      expect(response.body.code).toBe('APPLICATION_NOT_FOUND');
    }

    // Nothing was mutated behind the failed responses.
    const stored = await Application.findById(aliceApplication.id);
    expect(stored?.company).toBe('Alice Only Ltd');
    expect(stored?.status).toBe('saved');
  });

  it('returns the same 404 for another account record and for one that never existed', async () => {
    const alice = await registerUser(app);
    const bob = await registerUser(app);
    const aliceApplication = await createApplicationFor(app, alice.accessToken);

    const foreign = await request(app)
      .get(`${APPLICATIONS_BASE}/${aliceApplication.id}`)
      .set(auth(bob.accessToken));
    const missing = await request(app)
      .get(`${APPLICATIONS_BASE}/64b7f0000000000000000000`)
      .set(auth(bob.accessToken));

    expect(foreign.status).toBe(missing.status);
    expect(foreign.body.code).toBe(missing.body.code);
    expect(foreign.body.message).toBe(missing.body.message);
  });

  it('never lists another account applications', async () => {
    const alice = await registerUser(app);
    const bob = await registerUser(app);
    await createApplicationFor(app, alice.accessToken, { company: 'Alice Only Ltd' });
    await createApplicationFor(app, bob.accessToken, { company: 'Bob Only Ltd' });

    const listed = await request(app).get(APPLICATIONS_BASE).set(auth(bob.accessToken));

    expect(listed.body.data.applications).toHaveLength(1);
    expect(listed.body.data.applications[0].company).toBe('Bob Only Ltd');
    expect(listed.body.meta.total).toBe(1);
  });

  it('ignores another account ids inside a bulk action and reports them as not found', async () => {
    const alice = await registerUser(app);
    const bob = await registerUser(app);
    const aliceApplication = await createApplicationFor(app, alice.accessToken, {
      company: 'Alice Only Ltd',
    });
    const bobApplication = await createApplicationFor(app, bob.accessToken);

    const response = await request(app)
      .post(`${APPLICATIONS_BASE}/bulk`)
      .set(auth(bob.accessToken))
      .send({ ids: [bobApplication.id, aliceApplication.id], action: 'delete' });

    expect(response.status).toBe(200);
    expect(response.body.data.modified).toBe(1);
    expect(response.body.data.notFound).toEqual([aliceApplication.id]);

    // The row belonging to the other account survived untouched.
    expect(await Application.findById(aliceApplication.id)).not.toBeNull();
    expect(await Application.findById(bobApplication.id)).toBeNull();
  });

  it('refuses a bulk status change that reaches across accounts', async () => {
    const alice = await registerUser(app);
    const bob = await registerUser(app);
    const aliceApplication = await createApplicationFor(app, alice.accessToken);

    const response = await request(app)
      .post(`${APPLICATIONS_BASE}/bulk`)
      .set(auth(bob.accessToken))
      .send({
        ids: [aliceApplication.id],
        action: 'setStatus',
        payload: { status: 'rejected' },
      });

    expect(response.body.data.modified).toBe(0);
    expect(response.body.data.notFound).toEqual([aliceApplication.id]);

    const stored = await Application.findById(aliceApplication.id);
    expect(stored?.status).toBe('saved');
    expect(stored?.statusHistory).toHaveLength(1);
  });

  it('hides another account application from the interviews subresource', async () => {
    const alice = await registerUser(app);
    const bob = await registerUser(app);
    const aliceApplication = await createApplicationFor(app, alice.accessToken);

    const response = await request(app)
      .post(`${APPLICATIONS_BASE}/${aliceApplication.id}/interviews`)
      .set(auth(bob.accessToken))
      .send({ type: 'technical', mode: 'video', scheduledAt: new Date().toISOString() });

    expect(response.status).toBe(404);
    expect(response.body.code).toBe('APPLICATION_NOT_FOUND');

    const stored = await Application.findById(aliceApplication.id);
    expect(stored?.interviews).toHaveLength(0);
  });

  it('excludes another account records from export', async () => {
    const alice = await registerUser(app);
    const bob = await registerUser(app);
    await createApplicationFor(app, alice.accessToken, { company: 'Alice Only Ltd' });
    await createApplicationFor(app, bob.accessToken, { company: 'Bob Only Ltd' });

    const response = await request(app)
      .get(`${APPLICATIONS_BASE}/export?format=csv`)
      .set(auth(bob.accessToken));

    expect(response.text).toContain('Bob Only Ltd');
    expect(response.text).not.toContain('Alice Only Ltd');
  });
});
