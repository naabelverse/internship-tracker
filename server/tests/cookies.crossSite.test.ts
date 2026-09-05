import request from 'supertest';
import { env } from '@/config/env';
import { REFRESH_COOKIE_NAME, refreshCookieSitePolicy } from '@/utils/cookies';
import {
  AUTH_BASE,
  buildRegisterPayload,
  buildTestApp,
  useCleanAuthRateLimits,
} from './helpers/factories';
import { useTestDatabase } from './helpers/testDb';

useTestDatabase();
useCleanAuthRateLimits();

const app = buildTestApp();

/** The whole `Set-Cookie` line, attributes included — `extractRefreshCookie` drops them. */
async function registerAndReadRefreshCookie(): Promise<string> {
  const response = await request(app).post(`${AUTH_BASE}/register`).send(buildRegisterPayload());

  expect(response.status).toBe(201);

  const header: unknown = response.headers['set-cookie'];
  const cookies = (Array.isArray(header) ? header : [header]).filter(
    (value): value is string => typeof value === 'string',
  );
  const match = cookies.find((value) => value.startsWith(`${REFRESH_COOKIE_NAME}=`));

  if (!match) throw new Error('Response did not set a refresh cookie');

  return match;
}

/**
 * The refresh cookie has to survive the split-host deployment.
 *
 * DEPLOYMENT.md puts the client on Vercel and the API on Render, which are
 * different *sites*, and a browser omits a `SameSite=Strict` cookie from every
 * request a page on another site initiates. `POST /auth/refresh` is one, so the
 * cookie never arrives, the silent refresh 401s and the interceptor logs the user
 * out — while every test and both compose stacks stay green, because
 * `localhost:5174` and `localhost:5001` are different origins but the *same site*.
 * That is the gap these cases close: they vary the configured hosts rather than
 * the ports, which is the only thing that changes the answer.
 */
describe('refresh cookie across the deployed split-host boundary', () => {
  describe('the policy itself', () => {
    it('keeps Strict when the client and the API share a host', () => {
      expect(
        refreshCookieSitePolicy('http://localhost:5173', 'http://localhost:5000', false),
      ).toEqual({ sameSite: 'strict', secure: false });
    });

    it('keeps Strict across differing ports, which are the same site', () => {
      // The end-to-end stack. Cross-origin, same-site: a Strict cookie travels.
      expect(
        refreshCookieSitePolicy('http://localhost:5174', 'http://localhost:5001', false),
      ).toEqual({ sameSite: 'strict', secure: false });
    });

    it('relaxes to None + Secure across differing hosts', () => {
      expect(
        refreshCookieSitePolicy(
          'https://tracker.example.com',
          'https://tracker-api.onrender.com',
          true,
        ),
      ).toEqual({ sameSite: 'none', secure: true });
    });

    it('refuses to relax over plain HTTP, where Secure would drop the cookie', () => {
      // No SameSite value makes a cross-site cookie work without HTTPS, so this
      // fails visibly at the browser rather than silently in the cookie jar.
      expect(refreshCookieSitePolicy('http://client.test', 'http://api.test', false)).toEqual({
        sameSite: 'strict',
        secure: false,
      });
    });
  });

  describe('the header the route actually sends', () => {
    const originalClientOrigin = env.CLIENT_ORIGIN;
    const originalApiUrl = env.API_URL;
    const originalCookieDomain = env.COOKIE_DOMAIN;

    afterEach(() => {
      env.CLIENT_ORIGIN = originalClientOrigin;
      env.API_URL = originalApiUrl;
      env.COOKIE_DOMAIN = originalCookieDomain;
    });

    it('sends SameSite=None; Secure when the hosts differ', async () => {
      env.CLIENT_ORIGIN = 'https://tracker.example.com';
      env.API_URL = 'https://tracker-api.onrender.com';

      const cookie = await registerAndReadRefreshCookie();

      expect(cookie).toContain('SameSite=None');
      expect(cookie).toContain('Secure');
      // Still every protection the same-site version had.
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('Path=/api/v1/auth');
      expect(cookie).not.toContain('Domain=');
    });

    it('adds Domain only when COOKIE_DOMAIN is set', async () => {
      env.CLIENT_ORIGIN = 'https://tracker.example.com';
      env.API_URL = 'https://api.tracker.example.com';
      env.COOKIE_DOMAIN = '.tracker.example.com';

      const cookie = await registerAndReadRefreshCookie();

      expect(cookie).toContain('Domain=.tracker.example.com');
    });

    it('stays SameSite=Strict in the local same-host configuration', async () => {
      const cookie = await registerAndReadRefreshCookie();

      expect(cookie).toContain('SameSite=Strict');
      expect(cookie).not.toContain('Domain=');
    });
  });
});
