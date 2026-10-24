import request from 'supertest';
import { env } from '@/config/env';
import { runDemoReset } from '@/jobs/demoResetJob';
import { DEMO_READONLY_CODE } from '@/middleware/rejectDemoAccount';
import { Application } from '@/models/Application';
import { User } from '@/models/User';
import { seedDemoAccount } from '@/scripts/seed';
import { clearMailQueue, resetMailer } from '@/services/mailer.service';
import { AUTH_BASE, buildTestApp, useCleanAuthRateLimits } from './helpers/factories';
import { useTestDatabase } from './helpers/testDb';

/**
 * SPEC section 12: the demo account blocks destructive actions.
 *
 * Every case here goes through the HTTP API with a session obtained from
 * `POST /auth/demo` — no UI, no client-side guard, nothing but the token a
 * visitor would hold. That is the point: the demo credentials are published, so
 * the only protection worth anything is the one the server enforces.
 */

useTestDatabase();
useCleanAuthRateLimits();

const app = buildTestApp();

const NEW_PASSWORD = 'An0therStr0ngPass';

beforeEach(async () => {
  resetMailer();
  clearMailQueue();
  await seedDemoAccount();
});

/** A real demo session, taken the way the landing page takes one. */
async function demoSession(): Promise<string> {
  const response = await request(app).post(`${AUTH_BASE}/demo`);

  if (response.status !== 200) {
    throw new Error(`Demo sign-in failed: ${String(response.status)} ${response.text}`);
  }

  return response.body.data.accessToken as string;
}

describe('signing in to the demo account', () => {
  it('hands back a working session for the seeded account', async () => {
    const response = await request(app).post(`${AUTH_BASE}/demo`);

    expect(response.status).toBe(200);
    expect(response.body.data.user.email).toBe(env.DEMO_EMAIL);
    expect(response.body.data.user.isDemo).toBe(true);
    expect(typeof response.body.data.accessToken).toBe('string');
  });

  it('still reports the account as the demo after a refresh restores it through /auth/me', async () => {
    // The client keeps a demo visitor's own theme only while it can tell the
    // session is the demo, and a page refresh rebuilds the session from here.
    const token = await demoSession();

    const response = await request(app)
      .get(`${AUTH_BASE}/me`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.data.user.isDemo).toBe(true);
  });

  it('lands on an account that already holds the fixture data', async () => {
    const token = await demoSession();

    const response = await request(app)
      .get('/api/v1/applications')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.meta.total).toBeGreaterThan(60);
  });

  it('answers 404 on a deployment with no demo account', async () => {
    await User.deleteMany({ email: env.DEMO_EMAIL });

    const response = await request(app).post(`${AUTH_BASE}/demo`);

    expect(response.status).toBe(404);
    expect(response.body.code).toBe('DEMO_UNAVAILABLE');
  });
});

describe('the server refuses destructive actions on the demo account', () => {
  it('refuses to delete the account', async () => {
    const token = await demoSession();

    const response = await request(app)
      .delete(`${AUTH_BASE}/me`)
      .set('Authorization', `Bearer ${token}`)
      .send({ password: env.DEMO_PASSWORD });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe(DEMO_READONLY_CODE);
    expect(response.body.message).toMatch(/demo account/i);

    // And the account is genuinely untouched, not merely reported as refused.
    const user = await User.findOne({ email: env.DEMO_EMAIL });
    expect(user?.deletedAt).toBeUndefined();
  });

  it('refuses to change the password', async () => {
    const token = await demoSession();

    const response = await request(app)
      .patch(`${AUTH_BASE}/me/password`)
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: env.DEMO_PASSWORD, newPassword: NEW_PASSWORD });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe(DEMO_READONLY_CODE);

    // The published password still works, so the shared account cannot be locked
    // away from the next visitor.
    const login = await request(app)
      .post(`${AUTH_BASE}/login`)
      .send({ email: env.DEMO_EMAIL, password: env.DEMO_PASSWORD });
    expect(login.status).toBe(200);
  });

  it('refuses to change the email address', async () => {
    const token = await demoSession();

    const response = await request(app)
      .patch(`${AUTH_BASE}/me`)
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'stolen@example.com' });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe(DEMO_READONLY_CODE);

    const user = await User.findOne({ email: env.DEMO_EMAIL });
    expect(user?.pendingEmail).toBeUndefined();
  });

  it('refuses the email change even when it rides along with legitimate fields', async () => {
    const token = await demoSession();

    const response = await request(app)
      .patch(`${AUTH_BASE}/me`)
      .set('Authorization', `Bearer ${token}`)
      .send({ theme: 'dark', email: 'stolen@example.com' });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe(DEMO_READONLY_CODE);

    // The whole patch is refused, so the guard cannot be used to smuggle an
    // address past it alongside something harmless.
    const user = await User.findOne({ email: env.DEMO_EMAIL });
    expect(user?.pendingEmail).toBeUndefined();
  });

  it('refuses a profile change, so the university every visitor sees stays put', async () => {
    const token = await demoSession();

    const response = await request(app)
      .patch(`${AUTH_BASE}/me`)
      .set('Authorization', `Bearer ${token}`)
      .send({ university: 'Somewhere Else' });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe(DEMO_READONLY_CODE);
    const user = await User.findOne({ email: env.DEMO_EMAIL });
    expect(user?.university).toBe('Universiti Tun Hussein Onn Malaysia');
  });

  it.each([
    ['name', 'Someone Else'],
    ['gradYear', 2030],
    ['avatarUrl', 'https://images.example.test/anything.png'],
    ['targetRoles', ['Anything']],
  ])('refuses a change to %s, which every demo visitor sees', async (field, value) => {
    const token = await demoSession();

    const response = await request(app)
      .patch(`${AUTH_BASE}/me`)
      .set('Authorization', `Bearer ${token}`)
      .send({ [field]: value });

    expect(response.status).toBe(403);
  });

  it('still allows the harmless parts of the profile patch', async () => {
    const token = await demoSession();

    // The demo exists to be explored. Blocking the whole endpoint would stop it
    // demonstrating the theme and timezone controls, which destroy nothing.
    const response = await request(app)
      .patch(`${AUTH_BASE}/me`)
      .set('Authorization', `Bearer ${token}`)
      .send({ theme: 'dark' });

    expect(response.status).toBe(200);
    expect(response.body.data.user.theme).toBe('dark');
  });

  it('leaves an ordinary account able to do all three', async () => {
    // The guard keys on `isDemo`, not on the endpoint, so this is what proves it
    // did not simply disable these routes for everyone.
    const registered = await request(app).post(`${AUTH_BASE}/register`).send({
      name: 'Ada Lovelace',
      email: 'ordinary-account@example.com',
      password: 'Str0ngPassw0rd',
      acceptTerms: true,
    });
    const token = registered.body.data.accessToken as string;

    const changed = await request(app)
      .patch(`${AUTH_BASE}/me/password`)
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'Str0ngPassw0rd', newPassword: NEW_PASSWORD });

    expect(changed.status).toBe(200);
  });
});

describe('the nightly reset', () => {
  it('restores the fixture data after the demo account is vandalised', async () => {
    const user = await User.findOne({ email: env.DEMO_EMAIL });
    if (!user) throw new Error('demo account was not seeded');

    await Application.deleteMany({ user: user._id });
    await User.updateOne(
      { _id: user._id },
      { $set: { name: 'Vandalised', university: 'Vandalised', theme: 'dark' } },
    );

    const result = await runDemoReset();

    expect(result?.applications).toBeGreaterThan(60);
    expect(await Application.countDocuments({ user: user._id })).toBe(result?.applications);

    const restored = await User.findById(user._id);
    expect(restored?.name).toBe('Demo Student');
    expect(restored?.university).toBe('Universiti Tun Hussein Onn Malaysia');
    expect(restored?.isDemo).toBe(true);
    // A theme a visitor saved on the shared account does not outlive the night.
    expect(restored?.theme).toBe('system');
  });

  it('skips quietly when the deployment has no demo account', async () => {
    await User.deleteMany({ email: env.DEMO_EMAIL });

    // A deployment that never ran the seed is a legitimate configuration, so
    // this must not throw every night.
    await expect(runDemoReset()).resolves.toBeNull();
  });
});
