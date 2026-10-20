import type { Profile } from 'passport-google-oauth20';
import request from 'supertest';
import { env } from '@/config/env';
import { GOOGLE_STRATEGY, passport } from '@/config/googleAuth';
import { resetAuthRateLimiters } from '@/middleware/rateLimit';
import { User } from '@/models/User';
import { REFRESH_COOKIE_NAME } from '@/utils/cookies';
import { AUTH_BASE, buildTestApp, registerUser } from './helpers/factories';
import { useTestDatabase } from './helpers/testDb';

useTestDatabase();

const app = buildTestApp();

beforeEach(() => {
  resetAuthRateLimiters();
});

afterEach(() => {
  jest.restoreAllMocks();
});

let sequence = 0;

/** A Google profile as passport-google-oauth20 parses it, unique by default. */
function buildGoogleProfile(
  overrides: { id?: string; email?: string; verified?: boolean; name?: string } = {},
): Profile {
  sequence += 1;
  const email = overrides.email ?? `google-${String(sequence)}@example.com`;

  return {
    provider: 'google',
    id: overrides.id ?? `10000000000000000000${String(sequence)}`,
    displayName: overrides.name ?? 'Grace Hopper',
    emails: [{ value: email, verified: overrides.verified ?? true }],
    profileUrl: '',
    _raw: '',
    _json: {} as Profile['_json'],
  };
}

interface StrategyInternals {
  _oauth2: {
    getOAuthAccessToken(
      code: string,
      params: Record<string, string>,
      callback: (error: unknown, accessToken?: string) => void,
    ): void;
  };
  userProfile(accessToken: string, done: (error: unknown, profile?: Profile) => void): void;
}

/**
 * Replaces the two network calls the strategy makes, the code exchange and the
 * profile fetch, and returns the exchange mock so a case can read its params.
 */
function stubGoogle(profile: Profile): jest.SpyInstance {
  // `_strategy` is Passport's own lookup; it is not in the public typings.
  const strategy = (
    passport as unknown as { _strategy(name: string): StrategyInternals }
  )._strategy(GOOGLE_STRATEGY);

  jest.spyOn(strategy, 'userProfile').mockImplementation((_token, done) => {
    done(null, profile);
  });

  return jest
    .spyOn(strategy._oauth2, 'getOAuthAccessToken')
    .mockImplementation((_code, _params, callback) => {
      callback(null, 'google-access-token');
    });
}

function setCookies(response: request.Response): string[] {
  const header: unknown = response.headers['set-cookie'];
  return (Array.isArray(header) ? header : [header]).filter(
    (value): value is string => typeof value === 'string',
  );
}

async function startFlow(query: Record<string, string> = {}) {
  const response = await request(app).get(`${AUTH_BASE}/google`).query(query);
  const location = new URL(response.headers.location as string);
  const stateCookie = setCookies(response).find((c) => c.startsWith('google_oauth_state='));

  return { response, location, stateCookie, state: location.searchParams.get('state') ?? '' };
}

/** Runs the whole round trip: start, "consent at Google", callback. */
async function signInWithGoogle(profile: Profile, query: Record<string, string> = {}) {
  const exchange = stubGoogle(profile);
  const { state, stateCookie } = await startFlow(query);

  const callback = await request(app)
    .get(`${AUTH_BASE}/google/callback`)
    .query({ code: 'authorization-code', state })
    .set('Cookie', stateCookie?.split(';')[0] ?? '');

  return { callback, exchange, location: new URL(callback.headers.location as string) };
}

const refreshCookieOf = (response: request.Response): string | undefined =>
  setCookies(response).find((c) => c.startsWith(`${REFRESH_COOKIE_NAME}=`) && !c.includes('=;'));

describe('GET /auth/google', () => {
  it('redirects to Google with a state handle, PKCE and a scoped state cookie', async () => {
    const { response, location, stateCookie, state } = await startFlow({ intent: 'register' });

    expect(response.status).toBe(302);
    expect(location.host).toBe('accounts.google.com');
    expect(location.searchParams.get('scope')).toBe('openid email profile');
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
    expect(location.searchParams.get('code_challenge')).toBeTruthy();
    expect(location.searchParams.get('redirect_uri')).toBe(
      `${env.API_URL}/api/v1/auth/google/callback`,
    );
    expect(state.length).toBeGreaterThan(20);
    expect(stateCookie).toMatch(/HttpOnly/);
    expect(stateCookie).toMatch(/SameSite=Lax/);
    expect(stateCookie).toMatch(/Path=\/api\/v1\/auth\/google/);
  });

  it('rejects an intent it does not know', async () => {
    const response = await request(app).get(`${AUTH_BASE}/google`).query({ intent: 'admin' });

    expect(response.status).toBe(400);
  });
});

describe('GET /auth/google/callback', () => {
  it('creates a verified account from the register page and lands on the dashboard', async () => {
    const profile = buildGoogleProfile({ name: 'Grace Hopper' });

    const { callback, exchange, location } = await signInWithGoogle(profile, {
      intent: 'register',
      timezone: 'Asia/Kuala_Lumpur',
    });

    expect(callback.status).toBe(302);
    expect(location.toString()).toBe(new URL('/dashboard', env.APP_URL).toString());
    // The verifier from the state cookie reached the code exchange.
    expect(exchange.mock.calls[0][1]).toMatchObject({ code_verifier: expect.any(String) });

    const user = await User.findOne({ googleId: profile.id });
    expect(user).toMatchObject({
      name: 'Grace Hopper',
      email: profile.emails?.[0].value,
      emailVerified: true,
      timezone: 'Asia/Kuala_Lumpur',
    });
    expect(user?.acceptedTermsAt).toBeInstanceOf(Date);

    // The cookie is a real session: the client's cold-start refresh accepts it.
    const refresh = await request(app)
      .post(`${AUTH_BASE}/refresh`)
      .set('Cookie', refreshCookieOf(callback)?.split(';')[0] ?? '');
    expect(refresh.status).toBe(200);
  });

  it('never creates an account from the sign-in page', async () => {
    const profile = buildGoogleProfile();

    const { location, callback } = await signInWithGoogle(profile, { intent: 'login' });

    expect(location.pathname).toBe('/login');
    expect(location.searchParams.get('oauth')).toBe('NO_ACCOUNT');
    expect(refreshCookieOf(callback)).toBeUndefined();
    expect(await User.countDocuments({ googleId: profile.id })).toBe(0);
  });

  it('links a verified password account, and its password still signs in', async () => {
    const { payload, userId } = await registerUser(app);
    await User.updateOne({ _id: userId }, { emailVerified: true });
    const profile = buildGoogleProfile({ email: payload.email.toUpperCase() });

    const { location } = await signInWithGoogle(profile);

    expect(location.pathname).toBe('/dashboard');
    expect((await User.findById(userId))?.googleId).toBe(profile.id);

    const login = await request(app)
      .post(`${AUTH_BASE}/login`)
      .send({ email: payload.email, password: payload.password });
    expect(login.status).toBe(200);
  });

  it('signs a linked account in by Google id after its email changed', async () => {
    const profile = buildGoogleProfile();
    await signInWithGoogle(profile, { intent: 'register' });
    await User.updateOne({ googleId: profile.id }, { email: 'renamed@example.com' });

    const { location } = await signInWithGoogle(profile);

    expect(location.pathname).toBe('/dashboard');
  });

  it.each([
    ['an unverified account with that email', 'ACCOUNT_UNVERIFIED', { emailVerified: false }],
    ['a closed account', 'ACCOUNT_CLOSED', { emailVerified: true, deletedAt: new Date() }],
    ['the demo account', 'DEMO_ACCOUNT', { emailVerified: true, isDemo: true }],
    [
      'an account linked to another Google account',
      'GOOGLE_ACCOUNT_MISMATCH',
      { emailVerified: true, googleId: 'some-other-google-account' },
    ],
  ])('refuses %s', async (_label, code, state) => {
    const { payload, userId } = await registerUser(app);
    await User.updateOne({ _id: userId }, state);

    const { location, callback } = await signInWithGoogle(
      buildGoogleProfile({ email: payload.email }),
    );

    expect(location.searchParams.get('oauth')).toBe(code);
    expect(refreshCookieOf(callback)).toBeUndefined();
    if (code !== 'GOOGLE_ACCOUNT_MISMATCH') {
      expect((await User.findById(userId))?.googleId).toBeUndefined();
    }
  });

  it('refuses a Google address Google itself has not verified', async () => {
    const { location } = await signInWithGoogle(buildGoogleProfile({ verified: false }), {
      intent: 'register',
    });

    expect(location.pathname).toBe('/register');
    expect(location.searchParams.get('oauth')).toBe('GOOGLE_EMAIL_UNVERIFIED');
  });

  it('refuses a callback whose state this browser never started (login CSRF)', async () => {
    const exchange = stubGoogle(buildGoogleProfile());
    const { stateCookie } = await startFlow({ intent: 'register' });

    const callback = await request(app)
      .get(`${AUTH_BASE}/google/callback`)
      .query({ code: 'attacker-code', state: 'attacker-state-handle' })
      .set('Cookie', stateCookie?.split(';')[0] ?? '');

    expect(new URL(callback.headers.location as string).searchParams.get('oauth')).toBe(
      'GOOGLE_FAILED',
    );
    expect(exchange).not.toHaveBeenCalled();
  });

  it('sends a visitor who cancelled at Google back to sign in', async () => {
    const callback = await request(app)
      .get(`${AUTH_BASE}/google/callback`)
      .query({ error: 'access_denied' });

    expect(new URL(callback.headers.location as string).searchParams.get('oauth')).toBe(
      'GOOGLE_CANCELLED',
    );
  });
});
