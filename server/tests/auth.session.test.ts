import jwt from 'jsonwebtoken';
import request from 'supertest';
import { env } from '@/config/env';
import { resetAuthRateLimiters } from '@/middleware/rateLimit';
import { RefreshToken } from '@/models/RefreshToken';
import { User } from '@/models/User';
import { AUTH_BASE, buildTestApp, extractRefreshCookie, registerUser } from './helpers/factories';
import { useTestDatabase } from './helpers/testDb';

useTestDatabase();

const app = buildTestApp();

const ISSUER = 'internship-tracker';

beforeEach(() => {
  resetAuthRateLimiters();
});

const authed = (method: 'get' | 'patch' | 'post', path: string, token: string): request.Test =>
  request(app)[method](`${AUTH_BASE}${path}`).set('Authorization', `Bearer ${token}`);

describe('requireAuth', () => {
  it('rejects a request with no Authorization header', async () => {
    const response = await request(app).get(`${AUTH_BASE}/me`);

    expect(response.status).toBe(401);
    expect(response.body.code).toBe('UNAUTHENTICATED');
  });

  it('rejects a malformed Authorization header', async () => {
    const response = await request(app).get(`${AUTH_BASE}/me`).set('Authorization', 'Token abc');

    expect(response.status).toBe(401);
    expect(response.body.code).toBe('UNAUTHENTICATED');
  });

  it('rejects a token signed with the wrong secret', async () => {
    const { userId } = await registerUser(app);
    const forged = jwt.sign({ sub: userId, type: 'access' }, 'a-different-secret-entirely', {
      expiresIn: 900,
      issuer: ISSUER,
    });

    const response = await authed('get', '/me', forged);

    expect(response.status).toBe(401);
    expect(response.body.code).toBe('INVALID_ACCESS_TOKEN');
  });

  it('rejects an expired access token with a distinct code', async () => {
    const { userId } = await registerUser(app);
    const expired = jwt.sign({ sub: userId, type: 'access' }, env.JWT_ACCESS_SECRET, {
      expiresIn: -10,
      issuer: ISSUER,
    });

    const response = await authed('get', '/me', expired);

    expect(response.status).toBe(401);
    expect(response.body.code).toBe('ACCESS_TOKEN_EXPIRED');
  });

  it('rejects a token of the wrong type', async () => {
    const { userId } = await registerUser(app);
    const wrongType = jwt.sign({ sub: userId, type: 'refresh' }, env.JWT_ACCESS_SECRET, {
      expiresIn: 900,
      issuer: ISSUER,
    });

    const response = await authed('get', '/me', wrongType);

    expect(response.status).toBe(401);
    expect(response.body.code).toBe('INVALID_ACCESS_TOKEN');
  });

  it('rejects a token whose subject is no longer a live account', async () => {
    const { accessToken, userId } = await registerUser(app);
    await User.updateOne({ _id: userId }, { $set: { deletedAt: new Date() } });

    const response = await authed('get', '/me', accessToken);

    expect(response.status).toBe(401);
    expect(response.body.code).toBe('UNAUTHENTICATED');
  });
});

describe('GET /auth/me', () => {
  it('returns the signed-in account without private fields', async () => {
    const { accessToken, payload } = await registerUser(app);

    const response = await authed('get', '/me', accessToken);

    expect(response.status).toBe(200);
    expect(response.body.data.user.email).toBe(payload.email);
    expect(response.body.data.user.password).toBeUndefined();
    expect(response.body.data.user.failedLoginAttempts).toBeUndefined();
    expect(response.body.data.user.id).toBeDefined();
    expect(response.body.data.user._id).toBeUndefined();
  });
});

describe('PATCH /auth/me', () => {
  it('updates the allowed profile fields', async () => {
    const { accessToken } = await registerUser(app);

    const response = await authed('patch', '/me', accessToken).send({
      name: 'Grace Hopper',
      university: 'UTHM',
      gradYear: 2026,
      targetRoles: ['Frontend Intern', 'Backend Intern'],
      weeklyGoal: 8,
      theme: 'dark',
      timezone: 'Asia/Kuala_Lumpur',
      emailRemindersEnabled: false,
    });

    expect(response.status).toBe(200);
    expect(response.body.data.user).toMatchObject({
      name: 'Grace Hopper',
      university: 'UTHM',
      gradYear: 2026,
      weeklyGoal: 8,
      theme: 'dark',
      timezone: 'Asia/Kuala_Lumpur',
      emailRemindersEnabled: false,
    });
  });

  /**
   * Phase 2 rejected `email` outright, as a placeholder for a flow that did not
   * exist yet. Phase 11 built that flow, so the case was rewritten rather than
   * deleted: the address is now accepted and parked, and the assertion that
   * matters is that it does not take effect here.
   */
  it('parks a new email as pending rather than applying it', async () => {
    const { accessToken, payload } = await registerUser(app);

    const response = await authed('patch', '/me', accessToken).send({
      email: 'newaddress@example.com',
    });

    expect(response.status).toBe(200);
    expect(response.body.data.user.email).toBe(payload.email);
    expect(response.body.data.user.pendingEmail).toBe('newaddress@example.com');
  });

  it('refuses privilege fields such as isDemo', async () => {
    const { accessToken } = await registerUser(app);

    const response = await authed('patch', '/me', accessToken).send({ isDemo: true });

    expect(response.status).toBe(400);
  });

  it('rejects an empty patch', async () => {
    const { accessToken } = await registerUser(app);

    const response = await authed('patch', '/me', accessToken).send({});

    expect(response.status).toBe(400);
  });
});

describe('PATCH /auth/me/password', () => {
  const NEW_PASSWORD = 'Rotat3dPassword';

  it('changes the password and keeps the calling device signed in', async () => {
    const { accessToken, payload } = await registerUser(app);

    const response = await authed('patch', '/me/password', accessToken).send({
      currentPassword: payload.password,
      newPassword: NEW_PASSWORD,
    });

    expect(response.status).toBe(200);
    expect(typeof response.body.data.accessToken).toBe('string');

    const withNewToken = await authed('get', '/me', response.body.data.accessToken);
    expect(withNewToken.status).toBe(200);
  });

  it('rejects a wrong current password', async () => {
    const { accessToken } = await registerUser(app);

    const response = await authed('patch', '/me/password', accessToken).send({
      currentPassword: 'NotTheP4ssword',
      newPassword: NEW_PASSWORD,
    });

    expect(response.status).toBe(401);
    expect(response.body.code).toBe('INVALID_CREDENTIALS');
  });

  it('accepts the new password and rejects the old one at login', async () => {
    const { accessToken, payload } = await registerUser(app);

    await authed('patch', '/me/password', accessToken).send({
      currentPassword: payload.password,
      newPassword: NEW_PASSWORD,
    });

    resetAuthRateLimiters();
    const oldPassword = await request(app)
      .post(`${AUTH_BASE}/login`)
      .send({ email: payload.email, password: payload.password });
    resetAuthRateLimiters();
    const newPassword = await request(app)
      .post(`${AUTH_BASE}/login`)
      .send({ email: payload.email, password: NEW_PASSWORD });

    expect(oldPassword.status).toBe(401);
    expect(newPassword.status).toBe(200);
  });

  it('invalidates access tokens issued before the change via passwordChangedAt', async () => {
    const { accessToken, payload } = await registerUser(app);

    await authed('patch', '/me/password', accessToken).send({
      currentPassword: payload.password,
      newPassword: NEW_PASSWORD,
    });

    const withOldToken = await authed('get', '/me', accessToken);

    expect(withOldToken.status).toBe(401);
    expect(withOldToken.body.code).toBe('TOKEN_INVALIDATED');
  });

  it('invalidates a pre-change token even when both happen in the same second', async () => {
    const { accessToken, payload, userId } = await registerUser(app);

    // Pin passwordChangedAt to one millisecond after the token was issued: with a
    // whole-second `iat` comparison this token would wrongly survive.
    const issuedAtMs = (jwt.decode(accessToken) as { iatMs: number }).iatMs;
    await User.updateOne(
      { _id: userId },
      { $set: { passwordChangedAt: new Date(issuedAtMs + 1) } },
    );

    const response = await authed('get', '/me', accessToken);

    expect(response.status).toBe(401);
    expect(response.body.code).toBe('TOKEN_INVALIDATED');
    expect(payload.email).toBeDefined();
  });

  it('revokes every other refresh token', async () => {
    const registered = await registerUser(app);
    const otherDevice = await request(app)
      .post(`${AUTH_BASE}/login`)
      .send({ email: registered.payload.email, password: registered.payload.password });
    const otherCookie = extractRefreshCookie(otherDevice);

    await authed('patch', '/me/password', registered.accessToken).send({
      currentPassword: registered.payload.password,
      newPassword: NEW_PASSWORD,
    });

    const otherRefresh = await request(app).post(`${AUTH_BASE}/refresh`).set('Cookie', otherCookie);

    expect(otherRefresh.status).toBe(401);

    const revoked = await RefreshToken.countDocuments({
      user: registered.userId,
      revokedReason: 'password_changed',
    });
    expect(revoked).toBeGreaterThanOrEqual(2);
  });

  it('rejects reusing the current password as the new one', async () => {
    const { accessToken, payload } = await registerUser(app);

    const response = await authed('patch', '/me/password', accessToken).send({
      currentPassword: payload.password,
      newPassword: payload.password,
    });

    expect(response.status).toBe(400);
  });
});

describe('POST /auth/logout and /auth/logout-all', () => {
  it('revokes only the presented token on logout', async () => {
    const registered = await registerUser(app);
    const otherDevice = await request(app)
      .post(`${AUTH_BASE}/login`)
      .send({ email: registered.payload.email, password: registered.payload.password });
    const otherCookie = extractRefreshCookie(otherDevice);

    const response = await request(app)
      .post(`${AUTH_BASE}/logout`)
      .set('Cookie', registered.refreshCookie);

    expect(response.status).toBe(200);

    const loggedOut = await request(app)
      .post(`${AUTH_BASE}/refresh`)
      .set('Cookie', registered.refreshCookie);
    expect(loggedOut.status).toBe(401);

    const stillValid = await request(app).post(`${AUTH_BASE}/refresh`).set('Cookie', otherCookie);
    expect(stillValid.status).toBe(200);
  });

  it('succeeds even with no cookie, so a stale client can always sign out', async () => {
    const response = await request(app).post(`${AUTH_BASE}/logout`);

    expect(response.status).toBe(200);
  });

  it('revokes every session on logout-all', async () => {
    const registered = await registerUser(app);
    const otherDevice = await request(app)
      .post(`${AUTH_BASE}/login`)
      .send({ email: registered.payload.email, password: registered.payload.password });
    const otherCookie = extractRefreshCookie(otherDevice);

    const response = await authed('post', '/logout-all', registered.accessToken);

    expect(response.status).toBe(200);
    expect(response.body.data.revokedSessions).toBe(2);

    const first = await request(app)
      .post(`${AUTH_BASE}/refresh`)
      .set('Cookie', registered.refreshCookie);
    const second = await request(app).post(`${AUTH_BASE}/refresh`).set('Cookie', otherCookie);

    expect(first.status).toBe(401);
    expect(second.status).toBe(401);

    const live = await RefreshToken.countDocuments({ user: registered.userId, revokedAt: null });
    expect(live).toBe(0);
  });

  it('requires authentication for logout-all', async () => {
    const response = await request(app).post(`${AUTH_BASE}/logout-all`);

    expect(response.status).toBe(401);
  });
});
