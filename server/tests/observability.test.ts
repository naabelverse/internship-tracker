import request from 'supertest';
import type { Express } from 'express';
import { env } from '@/config/env';
import { attachSentryErrorHandler, isSentryEnabled } from '@/config/sentry';
import {
  APPLICATIONS_BASE,
  buildTestApp,
  registerUser,
  useCleanAuthRateLimits,
} from './helpers/factories';
import { useTestDatabase } from './helpers/testDb';

useTestDatabase();
useCleanAuthRateLimits();

let app: Express;

beforeAll(() => {
  app = buildTestApp();
});

/**
 * SPEC section 14 puts a request id on every response and every log line. Phase 1
 * built it; this asserts it still holds on the authenticated surface everything
 * since has been added to, not only on the probe `health.test.ts` covers.
 */
describe('request ids survive the whole middleware chain', () => {
  it('is on a successful authenticated response', async () => {
    const user = await registerUser(app);

    const response = await request(app)
      .get(APPLICATIONS_BASE)
      .set('Authorization', `Bearer ${user.accessToken}`);

    expect(response.status).toBe(200);
    expect(response.headers['x-request-id']).toMatch(/^[A-Za-z0-9-]{36}$/);
  });

  it('is on an error response, and matches the id in the body', async () => {
    const user = await registerUser(app);

    const response = await request(app)
      .get(`${APPLICATIONS_BASE}/64b7f0c2c1a4d9e5f2a10001`)
      .set('Authorization', `Bearer ${user.accessToken}`);

    expect(response.status).toBe(404);
    // Same id in the header and the envelope, which is what makes a user's
    // screenshot traceable to the log lines that produced it.
    expect(response.body.requestId).toBe(response.headers['x-request-id']);
  });

  it('is on a 401, before any route has run', async () => {
    const response = await request(app).get(APPLICATIONS_BASE);

    expect(response.status).toBe(401);
    expect(response.headers['x-request-id']).toBeTruthy();
    expect(response.body.requestId).toBe(response.headers['x-request-id']);
  });

  it('gives two requests two different ids', async () => {
    const first = await request(app).get('/health');
    const second = await request(app).get('/health');

    expect(first.headers['x-request-id']).not.toBe(second.headers['x-request-id']);
  });

  it('is on the new export and usage routes as well', async () => {
    const user = await registerUser(app);
    const auth = { Authorization: `Bearer ${user.accessToken}` };

    for (const url of ['/api/v1/auth/me/usage', '/api/v1/auth/me/export']) {
      const response = await request(app).get(url).set(auth);

      expect(response.status).toBe(200);
      expect(response.headers['x-request-id']).toBeTruthy();
    }
  });
});

/**
 * The gate SPEC section 14 asks for: Sentry is enabled "only when SENTRY_DSN is
 * set". The test environment sets nothing, which is also what CI and every local
 * checkout run with, so this is the configuration the assertions below describe.
 */
describe('Sentry stays out of the way when no DSN is configured', () => {
  it('is not enabled', () => {
    expect(env.SENTRY_DSN).toBeUndefined();
    expect(isSentryEnabled()).toBe(false);
  });

  it('attaching the error handler is a no-op that changes no behaviour', async () => {
    const bare = buildTestApp();

    // Calling it twice on an app that already had it applied by `createApp` must
    // still leave the API answering in its own envelope rather than Sentry's.
    attachSentryErrorHandler(bare);

    const response = await request(bare).get('/api/v1/applications');

    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ success: false, code: 'UNAUTHENTICATED' });
  });

  it('does not default the trace sample rate to anything but off', () => {
    // Traces are billed per event and this is a free-tier deployment.
    expect(env.SENTRY_TRACES_SAMPLE_RATE).toBe(0);
  });
});
