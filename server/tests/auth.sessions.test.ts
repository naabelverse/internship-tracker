import request from 'supertest';
import { resetAuthRateLimiters } from '@/middleware/rateLimit';
import { RefreshToken } from '@/models/RefreshToken';
import { clearMailQueue } from '@/services/mailer.service';
import { AUTH_BASE, buildTestApp, extractRefreshCookie, registerUser } from './helpers/factories';
import { useTestDatabase } from './helpers/testDb';

useTestDatabase();

const app = buildTestApp();

beforeEach(() => {
  resetAuthRateLimiters();
  clearMailQueue();
});

/** A second and third login for the same account, as if from other devices. */
async function signInAgain(email: string, password: string, device: string): Promise<string> {
  const response = await request(app)
    .post(`${AUTH_BASE}/login`)
    .set('user-agent', device)
    .send({ email, password });

  expect(response.status).toBe(200);

  return extractRefreshCookie(response);
}

describe('GET /auth/sessions', () => {
  it('lists the live tokens, marking the caller own session', async () => {
    const { payload, accessToken, refreshCookie } = await registerUser(app);
    await signInAgain(payload.email, payload.password, 'Second device');

    const response = await request(app)
      .get(`${AUTH_BASE}/sessions`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Cookie', refreshCookie);

    expect(response.status).toBe(200);
    expect(response.body.data.sessions).toHaveLength(2);

    const current = response.body.data.sessions.filter(
      (session: { current: boolean }) => session.current,
    );
    expect(current).toHaveLength(1);
  });

  it('never shows another account sessions', async () => {
    const { accessToken } = await registerUser(app);
    await registerUser(app, { email: 'someone.else@example.com' });

    const response = await request(app)
      .get(`${AUTH_BASE}/sessions`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(response.body.data.sessions).toHaveLength(1);
  });
});

describe('DELETE /auth/sessions/:id', () => {
  it('revokes exactly the targeted session and nothing else', async () => {
    const { payload, accessToken, refreshCookie, userId } = await registerUser(app);
    await signInAgain(payload.email, payload.password, 'Second device');
    await signInAgain(payload.email, payload.password, 'Third device');

    const listed = await request(app)
      .get(`${AUTH_BASE}/sessions`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Cookie', refreshCookie);

    const target = listed.body.data.sessions.find(
      (session: { current: boolean }) => !session.current,
    );

    const response = await request(app)
      .delete(`${AUTH_BASE}/sessions/${target.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Cookie', refreshCookie);

    expect(response.status).toBe(200);

    // Exactly one gone: not the caller own session, and not all of them.
    const live = await RefreshToken.find({ user: userId, revokedAt: null });
    expect(live).toHaveLength(2);

    const revoked = await RefreshToken.findById(target.id);
    expect(revoked?.revokedReason).toBe('session_revoked');

    // The caller is still signed in and can still refresh.
    const refreshed = await request(app).post(`${AUTH_BASE}/refresh`).set('Cookie', refreshCookie);
    expect(refreshed.status).toBe(200);
  });

  it('reports another account session as not found rather than forbidden', async () => {
    const { accessToken } = await registerUser(app);
    const other = await registerUser(app, { email: 'someone.else@example.com' });

    const theirs = await RefreshToken.findOne({ user: other.userId });

    if (!theirs) throw new Error('The other account has no refresh token');

    const response = await request(app)
      .delete(`${AUTH_BASE}/sessions/${theirs._id.toString()}`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(response.status).toBe(404);
    expect(response.body.code).toBe('SESSION_NOT_FOUND');

    // And it really is untouched.
    const stillLive = await RefreshToken.findById(theirs._id);
    expect(stillLive?.revokedAt ?? null).toBeNull();
  });
});

describe('password change and session revocation', () => {
  it('revokes every other session when the password changes', async () => {
    const { payload, accessToken, userId } = await registerUser(app);
    const otherDevice = await signInAgain(payload.email, payload.password, 'Second device');

    const changed = await request(app)
      .patch(`${AUTH_BASE}/me/password`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ currentPassword: payload.password, newPassword: 'BrandNewPass1' });

    expect(changed.status).toBe(200);

    // The other device cannot refresh any more.
    const stale = await request(app).post(`${AUTH_BASE}/refresh`).set('Cookie', otherDevice);
    expect(stale.status).toBe(401);

    // The caller was handed a fresh session, so exactly one token is live.
    const live = await RefreshToken.find({ user: userId, revokedAt: null });
    expect(live).toHaveLength(1);

    const revoked = await RefreshToken.find({ user: userId, revokedReason: 'password_changed' });
    expect(revoked.length).toBeGreaterThanOrEqual(2);
  });
});
