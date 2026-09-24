import request from 'supertest';
import { resetAuthRateLimiters } from '@/middleware/rateLimit';
import { Application } from '@/models/Application';
import { RefreshToken } from '@/models/RefreshToken';
import { User } from '@/models/User';
import { PURGE_AFTER_MS, purgeDeletedUsers } from '@/jobs/purgeDeletedUsersJob';
import { clearMailQueue, queuedMail } from '@/services/mailer.service';
import { APPLICATIONS_BASE, AUTH_BASE, buildTestApp, registerUser } from './helpers/factories';
import { useTestDatabase } from './helpers/testDb';

useTestDatabase();

const app = buildTestApp();

beforeEach(() => {
  resetAuthRateLimiters();
  clearMailQueue();
});

async function createApplication(accessToken: string, company: string): Promise<string> {
  const response = await request(app)
    .post(APPLICATIONS_BASE)
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ company, role: 'Backend Intern' });

  expect(response.status).toBe(201);

  return response.body.data.application.id;
}

async function closeAccount(accessToken: string, password: string): Promise<request.Response> {
  return request(app)
    .delete(`${AUTH_BASE}/me`)
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ password });
}

describe('DELETE /auth/me', () => {
  it('requires the current password', async () => {
    const { accessToken } = await registerUser(app);

    const response = await closeAccount(accessToken, 'NotThePassword1');

    expect(response.status).toBe(401);
    expect(response.body.code).toBe('INVALID_CREDENTIALS');

    const stillThere = await User.findOne({ deletedAt: null });
    expect(stillThere).not.toBeNull();
  });

  it('soft deletes, revokes every session and mails a confirmation', async () => {
    const { payload, accessToken, userId } = await registerUser(app);

    const response = await closeAccount(accessToken, payload.password);
    expect(response.status).toBe(200);

    const user = await User.findById(userId);
    expect(user).not.toBeNull();
    expect(user?.deletedAt).toBeInstanceOf(Date);

    const live = await RefreshToken.countDocuments({ user: userId, revokedAt: null });
    expect(live).toBe(0);

    expect(queuedMail().some((mail) => mail.kind === 'account_deleted')).toBe(true);
  });
});

describe('a soft deleted account is invisible', () => {
  // Rewritten deliberately with the restore flow. This used to assert that the
  // correct password got a 401; it now gets a restore prompt, and still no
  // session. The wrong-password half of the old promise is kept in
  // auth.restore.test.ts, which compares it byte for byte with an unknown email.
  it('gets a restore prompt, not a session, for the correct password', async () => {
    const { payload, accessToken } = await registerUser(app);
    await closeAccount(accessToken, payload.password);
    resetAuthRateLimiters();

    const response = await request(app)
      .post(`${AUTH_BASE}/login`)
      .send({ email: payload.email, password: payload.password });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('ACCOUNT_PENDING_DELETION');
    expect(response.body.data).toBeUndefined();
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('cannot use an access token that was already issued', async () => {
    const { payload, accessToken } = await registerUser(app);
    await closeAccount(accessToken, payload.password);

    const response = await request(app)
      .get(`${AUTH_BASE}/me`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(response.status).toBe(401);
  });

  it('keeps its applications out of every other account query', async () => {
    const doomed = await registerUser(app, { email: 'closing@example.com' });
    await createApplication(doomed.accessToken, 'Vanishing Corp');

    const survivor = await registerUser(app, { email: 'staying@example.com' });
    await createApplication(survivor.accessToken, 'Persistent Ltd');

    await closeAccount(doomed.accessToken, doomed.payload.password);

    const listed = await request(app)
      .get(APPLICATIONS_BASE)
      .set('Authorization', `Bearer ${survivor.accessToken}`);

    expect(listed.status).toBe(200);
    expect(listed.body.data.applications).toHaveLength(1);
    expect(listed.body.data.applications[0].company).toBe('Persistent Ltd');

    const summary = await request(app)
      .get('/api/v1/analytics/summary')
      .set('Authorization', `Bearer ${survivor.accessToken}`);

    expect(summary.status).toBe(200);
    expect(summary.body.data.total).toBe(1);
  });

  it('leaves the email reserved until the purge, so nothing can claim it early', async () => {
    const { payload, accessToken } = await registerUser(app);
    await closeAccount(accessToken, payload.password);
    resetAuthRateLimiters();

    const response = await request(app).post(`${AUTH_BASE}/register`).send({
      name: 'Someone Else',
      email: payload.email,
      password: 'Different1',
      acceptTerms: true,
    });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('EMAIL_IN_USE');
  });
});

describe('the purge job', () => {
  it('leaves an account inside its 30 day window alone', async () => {
    const { payload, accessToken } = await registerUser(app);
    await closeAccount(accessToken, payload.password);

    const result = await purgeDeletedUsers();

    expect(result.users).toBe(0);
    expect(await User.countDocuments({})).toBe(1);
  });

  it('removes the account and everything it owned once the window closes', async () => {
    const doomed = await registerUser(app, { email: 'closing@example.com' });
    await createApplication(doomed.accessToken, 'Vanishing Corp');

    const survivor = await registerUser(app, { email: 'staying@example.com' });
    await createApplication(survivor.accessToken, 'Persistent Ltd');

    await closeAccount(doomed.accessToken, doomed.payload.password);
    await User.updateOne(
      { _id: doomed.userId },
      { $set: { deletedAt: new Date(Date.now() - PURGE_AFTER_MS - 1000) } },
    );

    const result = await purgeDeletedUsers();

    expect(result.users).toBe(1);
    expect(result.applications).toBe(1);

    expect(await User.findById(doomed.userId)).toBeNull();
    expect(await Application.countDocuments({ user: doomed.userId })).toBe(0);
    expect(await RefreshToken.countDocuments({ user: doomed.userId })).toBe(0);

    // The account that was not deleted is untouched.
    expect(await User.findById(survivor.userId)).not.toBeNull();
    expect(await Application.countDocuments({ user: survivor.userId })).toBe(1);
  });

  it('never touches a live account', async () => {
    await registerUser(app);

    const result = await purgeDeletedUsers(new Date(Date.now() + PURGE_AFTER_MS * 10));

    expect(result.users).toBe(0);
    expect(await User.countDocuments({})).toBe(1);
  });
});
