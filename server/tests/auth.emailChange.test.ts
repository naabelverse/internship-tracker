import { Types } from 'mongoose';
import request from 'supertest';
import { resetAuthRateLimiters } from '@/middleware/rateLimit';
import { User } from '@/models/User';
import { VERIFICATION_GRACE_MS } from '@/services/accountLifecycle.service';
import { clearMailQueue, queuedMail } from '@/services/mailer.service';
import { APPLICATIONS_BASE, AUTH_BASE, buildTestApp, registerUser } from './helpers/factories';
import { useTestDatabase } from './helpers/testDb';

useTestDatabase();

const app = buildTestApp();

beforeEach(() => {
  resetAuthRateLimiters();
  clearMailQueue();
});

/**
 * Ages the account past the verification grace period.
 *
 * Through the raw driver on purpose: Mongoose marks `createdAt` immutable when
 * timestamps are enabled, so a model level `$set` is silently dropped and the
 * case would pass while proving nothing.
 */
async function ageAccount(userId: string, by: number): Promise<void> {
  await User.collection.updateOne(
    { _id: new Types.ObjectId(userId) },
    { $set: { createdAt: new Date(Date.now() - by) } },
  );
}

function latestVerificationToken(): string {
  const mail = [...queuedMail()].reverse().find((entry) => entry.kind === 'verify_email');

  if (!mail) throw new Error('No verification mail was queued');

  const match = /token=([\w-]+)/.exec(mail.text);

  if (!match) throw new Error('No token in the verification mail');

  return match[1];
}

describe('changing the email address', () => {
  const NEW_ADDRESS = 'moved.house@example.com';

  it('keeps the old address live until the new one is confirmed', async () => {
    const { payload, accessToken, userId } = await registerUser(app);
    clearMailQueue();

    const patched = await request(app)
      .patch(`${AUTH_BASE}/me`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ email: NEW_ADDRESS });

    expect(patched.status).toBe(200);
    expect(patched.body.data.user.email).toBe(payload.email);
    expect(patched.body.data.user.pendingEmail).toBe(NEW_ADDRESS);

    // The confirmation goes to the new address, not the old one.
    const mail = [...queuedMail()].reverse().find((entry) => entry.kind === 'verify_email');
    expect(mail?.to).toBe(NEW_ADDRESS);

    // The old address still signs in, and the new one does not yet.
    resetAuthRateLimiters();
    const oldStillWorks = await request(app)
      .post(`${AUTH_BASE}/login`)
      .send({ email: payload.email, password: payload.password });
    expect(oldStillWorks.status).toBe(200);

    resetAuthRateLimiters();
    const newDoesNot = await request(app)
      .post(`${AUTH_BASE}/login`)
      .send({ email: NEW_ADDRESS, password: payload.password });
    expect(newDoesNot.status).toBe(401);

    expect((await User.findById(userId))?.email).toBe(payload.email);
  });

  it('promotes the pending address through the ordinary verify-email flow', async () => {
    const { payload, accessToken, userId } = await registerUser(app);
    clearMailQueue();

    await request(app)
      .patch(`${AUTH_BASE}/me`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ email: NEW_ADDRESS });

    const confirmed = await request(app)
      .post(`${AUTH_BASE}/verify-email`)
      .send({ token: latestVerificationToken() });

    expect(confirmed.status).toBe(200);
    expect(confirmed.body.data.user.email).toBe(NEW_ADDRESS);
    expect(confirmed.body.data.user.pendingEmail).toBeUndefined();

    const user = await User.findById(userId);
    expect(user?.email).toBe(NEW_ADDRESS);
    expect(user?.emailVerified).toBe(true);

    // The swap is complete in both directions.
    resetAuthRateLimiters();
    const newWorks = await request(app)
      .post(`${AUTH_BASE}/login`)
      .send({ email: NEW_ADDRESS, password: payload.password });
    expect(newWorks.status).toBe(200);

    resetAuthRateLimiters();
    const oldGone = await request(app)
      .post(`${AUTH_BASE}/login`)
      .send({ email: payload.email, password: payload.password });
    expect(oldGone.status).toBe(401);
  });

  it('refuses an address another account already holds', async () => {
    await registerUser(app, { email: 'taken@example.com' });
    const { accessToken } = await registerUser(app, { email: 'mover@example.com' });

    const response = await request(app)
      .patch(`${AUTH_BASE}/me`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ email: 'taken@example.com' });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('EMAIL_IN_USE');
  });
});

describe('the seven day verification grace period', () => {
  it('lets an unverified account write during the window', async () => {
    const { accessToken } = await registerUser(app);

    const response = await request(app)
      .post(APPLICATIONS_BASE)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ company: 'Stripe', role: 'Backend Intern' });

    expect(response.status).toBe(201);
  });

  it('refuses writes once the window has closed, but never reads', async () => {
    const { accessToken, userId } = await registerUser(app);

    await request(app)
      .post(APPLICATIONS_BASE)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ company: 'Stripe', role: 'Backend Intern' });

    await ageAccount(userId, VERIFICATION_GRACE_MS + 1000);

    const write = await request(app)
      .post(APPLICATIONS_BASE)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ company: 'Monzo', role: 'Frontend Intern' });

    expect(write.status).toBe(403);
    expect(write.body.code).toBe('EMAIL_UNVERIFIED');

    // Nobody is locked out of their own data.
    const read = await request(app)
      .get(APPLICATIONS_BASE)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(read.status).toBe(200);
    expect(read.body.data.applications).toHaveLength(1);
  });

  it('never blocks login itself on verification', async () => {
    const { payload, userId } = await registerUser(app);

    await ageAccount(userId, VERIFICATION_GRACE_MS * 10);
    resetAuthRateLimiters();

    const response = await request(app)
      .post(`${AUTH_BASE}/login`)
      .send({ email: payload.email, password: payload.password });

    expect(response.status).toBe(200);
  });

  it('opens writing back up as soon as the address is confirmed', async () => {
    const { accessToken, userId } = await registerUser(app);
    const token = latestVerificationToken();

    await ageAccount(userId, VERIFICATION_GRACE_MS + 1000);

    await request(app).post(`${AUTH_BASE}/verify-email`).send({ token });

    const write = await request(app)
      .post(APPLICATIONS_BASE)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ company: 'Monzo', role: 'Frontend Intern' });

    expect(write.status).toBe(201);
  });
});
