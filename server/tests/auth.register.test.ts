import request from 'supertest';
import { resetAuthRateLimiters } from '@/middleware/rateLimit';
import { RefreshToken } from '@/models/RefreshToken';
import { User } from '@/models/User';
import { REFRESH_COOKIE_NAME } from '@/utils/cookies';
import { AUTH_BASE, buildRegisterPayload, buildTestApp } from './helpers/factories';
import { useTestDatabase } from './helpers/testDb';

useTestDatabase();

const app = buildTestApp();

// Auth limiters are live during tests; clear the counters so one case cannot
// throttle the next.
beforeEach(() => {
  resetAuthRateLimiters();
});

const postRegister = (body: object): request.Test =>
  request(app).post(`${AUTH_BASE}/register`).send(body);

describe('POST /auth/register', () => {
  it('creates an unverified account and returns an access token', async () => {
    const payload = buildRegisterPayload();

    const response = await postRegister(payload);

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      success: true,
      data: {
        user: {
          name: payload.name,
          email: payload.email,
          emailVerified: false,
          theme: 'system',
          weeklyGoal: 5,
          isDemo: false,
          schemaVersion: 1,
        },
      },
    });
    expect(typeof response.body.data.accessToken).toBe('string');
  });

  it('stores acceptedTermsAt and never returns the password hash', async () => {
    const payload = buildRegisterPayload();

    const response = await postRegister(payload);

    expect(response.body.data.user.password).toBeUndefined();
    expect(response.body.data.user.passwordResetTokenHash).toBeUndefined();
    expect(response.body.data.user.emailVerificationTokenHash).toBeUndefined();
    expect(JSON.stringify(response.body)).not.toContain('$2');

    const stored = await User.findOne({ email: payload.email }).select('+password');
    expect(stored?.acceptedTermsAt).toBeInstanceOf(Date);
    expect(stored?.password).toMatch(/^\$2[aby]\$12\$/);
  });

  it('hashes the password rather than storing it', async () => {
    const payload = buildRegisterPayload();

    await postRegister(payload);

    const stored = await User.findOne({ email: payload.email }).select('+password');
    expect(stored?.password).not.toBe(payload.password);
    expect(await stored?.comparePassword(payload.password)).toBe(true);
    expect(await stored?.comparePassword('WrongPassw0rd')).toBe(false);
  });

  it('sets an httpOnly refresh cookie scoped to the auth path', async () => {
    const response = await postRegister(buildRegisterPayload());

    const setCookie: unknown = response.headers['set-cookie'];
    const cookies = (Array.isArray(setCookie) ? setCookie : [setCookie]).filter(
      (value): value is string => typeof value === 'string',
    );
    const refreshCookie = cookies.find((value) => value.startsWith(`${REFRESH_COOKIE_NAME}=`));

    expect(refreshCookie).toBeDefined();
    expect(refreshCookie).toContain('HttpOnly');
    expect(refreshCookie).toContain('SameSite=Strict');
    expect(refreshCookie).toContain('Path=/api/v1/auth');
  });

  it('opens exactly one refresh token family', async () => {
    const payload = buildRegisterPayload();

    await postRegister(payload);

    const user = await User.findOne({ email: payload.email });
    const tokens = await RefreshToken.find({ user: user?._id });

    expect(tokens).toHaveLength(1);
    expect(tokens[0].revokedAt).toBeNull();
    expect(tokens[0].tokenHash).toHaveLength(64);
  });

  it('normalises the email to lowercase', async () => {
    const payload = buildRegisterPayload({ email: 'MixedCase@Example.COM' });

    const response = await postRegister(payload);

    expect(response.body.data.user.email).toBe('mixedcase@example.com');
  });

  it('captures the timezone when supplied', async () => {
    const response = await postRegister(buildRegisterPayload({ timezone: 'Asia/Kuala_Lumpur' }));

    expect(response.body.data.user.timezone).toBe('Asia/Kuala_Lumpur');
  });

  it('defaults the timezone to UTC when omitted', async () => {
    const response = await postRegister(buildRegisterPayload());

    expect(response.body.data.user.timezone).toBe('UTC');
  });

  describe('validation', () => {
    it('rejects a duplicate email with 409', async () => {
      const payload = buildRegisterPayload();
      await postRegister(payload);

      const response = await postRegister(payload);

      expect(response.status).toBe(409);
      expect(response.body.code).toBe('EMAIL_IN_USE');
    });

    it('rejects registration without accepting the terms', async () => {
      const { acceptTerms: _omitted, ...payload } = buildRegisterPayload();

      const response = await postRegister(payload);

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
      expect(response.body.errors.acceptTerms).toBeDefined();
    });

    it('rejects a weak password and explains why', async () => {
      const response = await postRegister(buildRegisterPayload({ password: 'weak' }));

      expect(response.status).toBe(400);
      expect(response.body.errors.password).toEqual(
        expect.arrayContaining([expect.stringContaining('at least 8 characters')]),
      );
    });

    it('rejects a malformed email', async () => {
      const response = await postRegister(buildRegisterPayload({ email: 'not-an-email' }));

      expect(response.status).toBe(400);
      expect(response.body.errors.email).toBeDefined();
    });

    it('rejects an invalid timezone', async () => {
      const response = await postRegister(buildRegisterPayload({ timezone: 'Mars/Olympus_Mons' }));

      expect(response.status).toBe(400);
      expect(response.body.errors.timezone).toBeDefined();
    });

    it('rejects unknown fields rather than silently ignoring them', async () => {
      const response = await postRegister({ ...buildRegisterPayload(), isDemo: true });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });
  });
});
