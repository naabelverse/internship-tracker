import request from 'supertest';
import { env } from '@/config/env';
import { User } from '@/models/User';
import { seedDemoAccount } from '@/scripts/seed';
import { clearMailQueue, resetMailer } from '@/services/mailer.service';
import { AUTH_BASE, buildTestApp, useCleanAuthRateLimits } from './helpers/factories';
import { useTestDatabase } from './helpers/testDb';

/**
 * `POST /auth/demo` is unauthenticated and needs no credential, so the question
 * is not whether it works but what else it can be made to do.
 *
 * Three things it must never do: create an account, sign a caller into an
 * account that is not the seeded demo one, or hand out a session that can be
 * turned into an account of one's own.
 */

useTestDatabase();
useCleanAuthRateLimits();

const app = buildTestApp();

beforeEach(() => {
  resetMailer();
  clearMailQueue();
});

describe('the demo route never creates an account', () => {
  it('creates nothing when there is no demo account to find', async () => {
    const before = await User.countDocuments({});

    const response = await request(app).post(`${AUTH_BASE}/demo`);

    expect(response.status).toBe(404);
    // The interesting assertion is the 404 *and* no new row. An implementation
    // that helpfully seeded on demand would be an open account factory.
    expect(await User.countDocuments({})).toBe(before);
  });

  it('creates nothing on repeated calls once the demo account exists', async () => {
    await seedDemoAccount();
    const before = await User.countDocuments({});

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await request(app).post(`${AUTH_BASE}/demo`);
    }

    expect(await User.countDocuments({})).toBe(before);
  });

  it('ignores a body trying to name an account to create or sign into', async () => {
    await seedDemoAccount();
    const victim = await request(app).post(`${AUTH_BASE}/register`).send({
      name: 'Real Person',
      email: 'victim@example.com',
      password: 'Str0ngPassw0rd',
      acceptTerms: true,
    });
    expect(victim.status).toBe(201);

    const before = await User.countDocuments({});

    // The route takes no body at all, so none of this can steer it. Asserted
    // rather than assumed, because "takes no body" is the whole security model.
    const response = await request(app)
      .post(`${AUTH_BASE}/demo`)
      .send({ email: 'victim@example.com', isDemo: true, name: 'Attacker' });

    expect(response.status).toBe(200);
    expect(response.body.data.user.email).toBe(env.DEMO_EMAIL);
    expect(await User.countDocuments({})).toBe(before);
  });
});

describe('the demo route only ever reaches the seeded demo account', () => {
  it('refuses an account holding the demo address that was not seeded as the demo', async () => {
    // Somebody registers the demo address before the deployment is seeded. That
    // account belongs to an ordinary user, and `isDemo` in the query is what
    // stops the button signing every visitor into it.
    await request(app).post(`${AUTH_BASE}/register`).send({
      name: 'Squatter',
      email: env.DEMO_EMAIL,
      password: 'Str0ngPassw0rd',
      acceptTerms: true,
    });

    const response = await request(app).post(`${AUTH_BASE}/demo`);

    expect(response.status).toBe(404);
    expect(response.body.code).toBe('DEMO_UNAVAILABLE');
  });

  it('refuses once the demo account has been closed', async () => {
    await seedDemoAccount();
    await User.updateOne({ email: env.DEMO_EMAIL }, { $set: { deletedAt: new Date() } });

    const response = await request(app).post(`${AUTH_BASE}/demo`);

    expect(response.status).toBe(404);
  });
});

describe('a demo session cannot be escalated into an account of one own', () => {
  it('cannot take the account over by changing its password, address or existence', async () => {
    await seedDemoAccount();
    const token = (await request(app).post(`${AUTH_BASE}/demo`)).body.data.accessToken as string;

    const attempts = await Promise.all([
      request(app)
        .patch(`${AUTH_BASE}/me/password`)
        .set('Authorization', `Bearer ${token}`)
        .send({ currentPassword: env.DEMO_PASSWORD, newPassword: 'Att4ckerOwned' }),
      request(app)
        .patch(`${AUTH_BASE}/me`)
        .set('Authorization', `Bearer ${token}`)
        .send({ email: 'attacker@example.com' }),
      request(app)
        .delete(`${AUTH_BASE}/me`)
        .set('Authorization', `Bearer ${token}`)
        .send({ password: env.DEMO_PASSWORD }),
    ]);

    expect(attempts.map((response) => response.status)).toEqual([403, 403, 403]);

    // The account is exactly as it was, and the next visitor gets it intact.
    const user = await User.findOne({ email: env.DEMO_EMAIL });
    expect(user?.deletedAt).toBeUndefined();
    expect(user?.pendingEmail).toBeUndefined();
    expect((await request(app).post(`${AUTH_BASE}/demo`)).status).toBe(200);
  });

  it('reaches no other account data through the demo session', async () => {
    await seedDemoAccount();
    const victim = await request(app).post(`${AUTH_BASE}/register`).send({
      name: 'Real Person',
      email: 'other-account@example.com',
      password: 'Str0ngPassw0rd',
      acceptTerms: true,
    });

    const created = await request(app)
      .post('/api/v1/applications')
      .set('Authorization', `Bearer ${String(victim.body.data.accessToken)}`)
      .send({ company: 'Private Company', role: 'Private Role' });
    expect(created.status).toBe(201);

    const token = (await request(app).post(`${AUTH_BASE}/demo`)).body.data.accessToken as string;
    const reachable = await request(app)
      .get(`/api/v1/applications/${String(created.body.data.application.id)}`)
      .set('Authorization', `Bearer ${token}`);

    // Ownership scoping applies to the demo session like any other.
    expect(reachable.status).toBe(404);
  });

  it('registering a new account still requires the full flow', async () => {
    await seedDemoAccount();
    const before = await User.countDocuments({});

    // The demo session confers nothing on registration: it is still a separate,
    // validated, terms-accepting call.
    const token = (await request(app).post(`${AUTH_BASE}/demo`)).body.data.accessToken as string;
    const withoutTerms = await request(app)
      .post(`${AUTH_BASE}/register`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'New Person', email: 'new-person@example.com', password: 'Str0ngPassw0rd' });

    expect(withoutTerms.status).toBe(400);
    expect(await User.countDocuments({})).toBe(before);
  });
});
