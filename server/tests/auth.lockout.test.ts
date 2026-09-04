import request from 'supertest';
import { resetAuthRateLimiters } from '@/middleware/rateLimit';
import { MAX_FAILED_LOGIN_ATTEMPTS, User } from '@/models/User';
import { clearMailQueue } from '@/services/mailer.service';
import { AUTH_BASE, buildTestApp, registerUser } from './helpers/factories';
import { useTestDatabase } from './helpers/testDb';

useTestDatabase();

const app = buildTestApp();

beforeEach(() => {
  resetAuthRateLimiters();
  clearMailQueue();
});

/**
 * Lockout and rate limiting are separate mechanisms that deliberately do not
 * share state, so the counters are reset between attempts here to isolate the
 * account level one. In production the IP limiter trips first, at five attempts;
 * these cases prove what happens to an attacker who is spreading the attempts
 * across addresses and so never trips it.
 */
async function failLogin(email: string): Promise<request.Response> {
  const response = await request(app)
    .post(`${AUTH_BASE}/login`)
    .send({ email, password: 'DefinitelyWrong1' });

  resetAuthRateLimiters();

  return response;
}

describe('account lockout', () => {
  it('locks after ten consecutive failures, with its own distinct code', async () => {
    const { payload } = await registerUser(app);
    resetAuthRateLimiters();

    for (let attempt = 0; attempt < MAX_FAILED_LOGIN_ATTEMPTS; attempt += 1) {
      const response = await failLogin(payload.email);

      // Every attempt up to the threshold is an ordinary credential failure:
      // the response must not tell an attacker how close the lock is.
      expect(response.status).toBe(401);
      expect(response.body.code).toBe('INVALID_CREDENTIALS');
    }

    // Even the right password is refused now, and with a different code than a
    // wrong password, so the user can be told what actually happened.
    const locked = await request(app)
      .post(`${AUTH_BASE}/login`)
      .send({ email: payload.email, password: payload.password });

    expect(locked.status).toBe(423);
    expect(locked.body.code).toBe('ACCOUNT_LOCKED');
    expect(locked.body.errors.lockedUntil).toEqual(expect.any(String));
  });

  it('clears the counter on a successful sign in', async () => {
    const { payload, userId } = await registerUser(app);
    resetAuthRateLimiters();

    await failLogin(payload.email);
    await failLogin(payload.email);

    expect((await User.findById(userId))?.failedLoginAttempts).toBe(2);

    const ok = await request(app)
      .post(`${AUTH_BASE}/login`)
      .send({ email: payload.email, password: payload.password });

    expect(ok.status).toBe(200);

    const user = await User.findById(userId);
    expect(user?.failedLoginAttempts).toBe(0);
    expect(user?.lockedUntil ?? null).toBeNull();
  });

  it('lets the user back in once the lock has expired', async () => {
    const { payload, userId } = await registerUser(app);
    resetAuthRateLimiters();

    for (let attempt = 0; attempt < MAX_FAILED_LOGIN_ATTEMPTS; attempt += 1) {
      await failLogin(payload.email);
    }

    await User.updateOne({ _id: userId }, { $set: { lockedUntil: new Date(Date.now() - 1000) } });

    const response = await request(app)
      .post(`${AUTH_BASE}/login`)
      .send({ email: payload.email, password: payload.password });

    expect(response.status).toBe(200);
  });

  it('is not the same mechanism as the rate limiter, and reports differently', async () => {
    const { payload } = await registerUser(app);
    resetAuthRateLimiters();

    // Six attempts without clearing the counters: the IP limiter owns this,
    // and it trips well before the account level lock could.
    let last = await request(app)
      .post(`${AUTH_BASE}/login`)
      .send({ email: payload.email, password: 'DefinitelyWrong1' });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      last = await request(app)
        .post(`${AUTH_BASE}/login`)
        .send({ email: payload.email, password: 'DefinitelyWrong1' });
    }

    expect(last.status).toBe(429);
    expect(last.body.code).toMatch(/^RATE_LIMITED_/);

    // A throttled attempt is not a failed one: the account counter is still
    // below the lock threshold, so the limiter cannot lock anyone out by proxy.
    const { User: UserModel } = await import('@/models/User');
    const user = await UserModel.findOne({ email: payload.email });
    expect(user?.failedLoginAttempts ?? 0).toBeLessThan(MAX_FAILED_LOGIN_ATTEMPTS);
  });

  it('a password reset clears the lock', async () => {
    const { payload, userId } = await registerUser(app);
    resetAuthRateLimiters();

    for (let attempt = 0; attempt < MAX_FAILED_LOGIN_ATTEMPTS; attempt += 1) {
      await failLogin(payload.email);
    }

    const { queuedMail } = await import('@/services/mailer.service');
    await request(app).post(`${AUTH_BASE}/forgot-password`).send({ email: payload.email });

    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (queuedMail().some((mail) => mail.kind === 'password_reset')) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    const mail = [...queuedMail()].reverse().find((entry) => entry.kind === 'password_reset');
    const match = mail ? /token=([\w-]+)/.exec(mail.text) : null;

    if (!match) throw new Error('No reset token was queued');

    const token = match[1];

    await request(app).post(`${AUTH_BASE}/reset-password`).send({ token, password: 'FreshStart1' });

    const user = await User.findById(userId);
    expect(user?.failedLoginAttempts).toBe(0);
    expect(user?.lockedUntil ?? null).toBeNull();

    resetAuthRateLimiters();
    const signIn = await request(app)
      .post(`${AUTH_BASE}/login`)
      .send({ email: payload.email, password: 'FreshStart1' });

    expect(signIn.status).toBe(200);
  });
});
