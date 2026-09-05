import request from 'supertest';
import {
  APPLICATIONS_BASE,
  AUTH_BASE,
  buildTestApp,
  registerUser,
  useCleanAuthRateLimits,
} from './helpers/factories';
import { useTestDatabase } from './helpers/testDb';

useTestDatabase();
useCleanAuthRateLimits();

const app = buildTestApp();

/** The origin the CORS layer is configured to allow, per `config/env`. */
const CLIENT_ORIGIN = 'http://localhost:5173';

/**
 * Downloads are cross-origin in production, and a browser hides response headers
 * the server does not explicitly expose.
 *
 * SPEC section 15 puts the client and the API on separate hosts, so every
 * download the SPA saves is a cross-origin read. Only the CORS-safelisted
 * response headers reach JavaScript by default, and `Content-Disposition` is not
 * one of them — so without `exposedHeaders` the client cannot see the filename
 * the server chose and every export lands under a generic fallback name instead
 * of the dated one. Development is same-origin and never shows it; Phase 15's
 * end-to-end run against a real cross-origin stack is what surfaced it.
 *
 * These cases pin the header to the responses that carry a filename.
 */
describe('Content-Disposition survives the cross-origin boundary', () => {
  it('is exposed on the applications export', async () => {
    const { accessToken } = await registerUser(app);

    const response = await request(app)
      .get(`${APPLICATIONS_BASE}/export`)
      .query({ format: 'csv' })
      .set('Origin', CLIENT_ORIGIN)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(response.status).toBe(200);
    expect(response.headers['content-disposition']).toMatch(
      /attachment; filename="applications-\d{4}-\d{2}-\d{2}\.csv"/,
    );
    // The header the browser actually consults before revealing the one above.
    expect(response.headers['access-control-expose-headers']).toMatch(/Content-Disposition/i);
  });

  it('is exposed on the account data export', async () => {
    const { accessToken } = await registerUser(app);

    const response = await request(app)
      .get(`${AUTH_BASE}/me/export`)
      .set('Origin', CLIENT_ORIGIN)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(response.status).toBe(200);
    expect(response.headers['content-disposition']).toContain('attachment; filename=');
    expect(response.headers['access-control-expose-headers']).toMatch(/Content-Disposition/i);
  });
});
