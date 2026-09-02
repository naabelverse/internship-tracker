import request from 'supertest';
import { resetAuthRateLimiters } from '@/middleware/rateLimit';
import { MAX_FAILED_LOGIN_ATTEMPTS, User } from '@/models/User';
import { AUTH_BASE, buildTestApp, registerUser } from './helpers/factories';
import { useTestDatabase } from './helpers/testDb';

useTestDatabase();

const app = buildTestApp();

// Login is limited to 5 attempts per window; the lockout cases need more than
// that, so the counters are cleared between and inside cases deliberately.
beforeEach(() => {
  resetAuthRateLimiters();
});

const postLogin = (body: object, ip = '203.0.113.10'): request.Test =>
  request(app).post(`${AUTH_BASE}/login`).set('X-Forwarded-For', ip).send(body);

describe('POST /auth/login', () => {
  it('signs in with correct credentials and records lastLoginAt', async () => {
    const { payload } = await registerUser(app);

    const response = await postLogin({ email: payload.email, password: payload.password });

    expect(response.status).toBe(200);
    expect(response.body.data.user.email).toBe(payload.email);
    expect(typeof response.body.data.accessToken).toBe('string');

    const user = await User.findOne({ email: payload.email });
    expect(user?.lastLoginAt).toBeInstanceOf(Date);
  });

  it('returns the same error for an unknown email and a wrong password', async () => {
    const { payload } = await registerUser(app);

    const wrongPassword = await postLogin({ email: payload.email, password: 'DefinitelyWr0ng' });
    resetAuthRateLimiters();
    const unknownEmail = await postLogin({
      email: 'nobody@example.com',
      password: payload.password,
    });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body.code).toBe(unknownEmail.body.code);
    expect(wrongPassword.body.message).toBe(unknownEmail.body.message);
  });

  it('is case insensitive on the email', async () => {
    const { payload } = await registerUser(app);

    const response = await postLogin({
      email: payload.email.toUpperCase(),
      password: payload.password,
    });

    expect(response.status).toBe(200);
  });

  it('opens a second independent session rather than replacing the first', async () => {
    const { payload, refreshCookie } = await registerUser(app);

    await postLogin({ email: payload.email, password: payload.password });

    const original = await request(app).post(`${AUTH_BASE}/refresh`).set('Cookie', refreshCookie);

    expect(original.status).toBe(200);
  });

  describe('failed attempt tracking', () => {
    it('increments failedLoginAttempts on each wrong password', async () => {
      const { payload } = await registerUser(app);

      for (let attempt = 0; attempt < 3; attempt += 1) {
        resetAuthRateLimiters();
        await postLogin({ email: payload.email, password: 'DefinitelyWr0ng' });
      }

      const user = await User.findOne({ email: payload.email });
      expect(user?.failedLoginAttempts).toBe(3);
      expect(user?.lockedUntil).toBeUndefined();
    });

    it('resets the counter after a successful sign-in', async () => {
      const { payload } = await registerUser(app);

      resetAuthRateLimiters();
      await postLogin({ email: payload.email, password: 'DefinitelyWr0ng' });
      resetAuthRateLimiters();
      await postLogin({ email: payload.email, password: payload.password });

      const user = await User.findOne({ email: payload.email });
      expect(user?.failedLoginAttempts).toBe(0);
    });

    it('locks the account after the configured number of consecutive failures', async () => {
      const { payload } = await registerUser(app);

      for (let attempt = 0; attempt < MAX_FAILED_LOGIN_ATTEMPTS; attempt += 1) {
        resetAuthRateLimiters();
        await postLogin({ email: payload.email, password: 'DefinitelyWr0ng' });
      }

      const user = await User.findOne({ email: payload.email });
      expect(user?.failedLoginAttempts).toBe(MAX_FAILED_LOGIN_ATTEMPTS);
      expect(user?.lockedUntil).toBeInstanceOf(Date);

      resetAuthRateLimiters();
      const locked = await postLogin({ email: payload.email, password: payload.password });

      expect(locked.status).toBe(423);
      expect(locked.body.code).toBe('ACCOUNT_LOCKED');
    });

    it('allows sign-in again once the lock has expired', async () => {
      const { payload } = await registerUser(app);

      await User.updateOne(
        { email: payload.email },
        {
          $set: {
            failedLoginAttempts: MAX_FAILED_LOGIN_ATTEMPTS,
            lockedUntil: new Date(Date.now() - 1_000),
          },
        },
      );

      const response = await postLogin({ email: payload.email, password: payload.password });

      expect(response.status).toBe(200);

      const user = await User.findOne({ email: payload.email });
      expect(user?.failedLoginAttempts).toBe(0);
      expect(user?.lockedUntil).toBeUndefined();
    });
  });

  describe('validation', () => {
    it('rejects a missing password', async () => {
      const response = await postLogin({ email: 'someone@example.com' });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });
  });
});
