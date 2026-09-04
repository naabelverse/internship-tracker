import { performance } from 'node:perf_hooks';
import request from 'supertest';
import { resetAuthRateLimiters } from '@/middleware/rateLimit';
import { clearMailQueue } from '@/services/mailer.service';
import { AUTH_BASE, buildTestApp, registerUser } from './helpers/factories';
import { useTestDatabase } from './helpers/testDb';

useTestDatabase();

const app = buildTestApp();

const ABSENT = 'nobody-has-this-address@example.com';

beforeEach(() => {
  resetAuthRateLimiters();
  clearMailQueue();
});

async function forgot(email: string): Promise<request.Response> {
  return request(app).post(`${AUTH_BASE}/forgot-password`).send({ email });
}

/**
 * SPEC section 5 and the definition of done: `POST /auth/forgot-password` must
 * answer identically for an address that has an account and one that does not.
 *
 * The guarantee is structural rather than two branches that happen to agree. The
 * handler never branches on existence: it writes one fixed response and only
 * then hands the address to the service, which does the token work for a real
 * account and returns immediately for anything else.
 */
describe('forgot-password does not reveal whether an account exists', () => {
  it('answers with the same status, body and headers either way', async () => {
    const { payload } = await registerUser(app);
    resetAuthRateLimiters();

    const real = await forgot(payload.email);
    const fake = await forgot(ABSENT);

    expect(real.status).toBe(200);
    expect(fake.status).toBe(real.status);
    expect(fake.body).toEqual(real.body);

    // Nothing distinguishing leaks through the envelope's shape either.
    expect(Object.keys(fake.body).sort()).toEqual(Object.keys(real.body).sort());
    expect(fake.headers['content-type']).toBe(real.headers['content-type']);
    expect(fake.headers['content-length']).toBe(real.headers['content-length']);
  });

  it('answers in the same order of magnitude either way', async () => {
    const { payload } = await registerUser(app);
    resetAuthRateLimiters();

    // Warm the code path first so neither figure pays for one-time setup.
    await forgot(payload.email);
    await forgot(ABSENT);
    resetAuthRateLimiters();

    const measure = async (email: string): Promise<number> => {
      const samples: number[] = [];

      for (let i = 0; i < 5; i += 1) {
        const started = performance.now();
        await forgot(email);
        samples.push(performance.now() - started);
        resetAuthRateLimiters();
      }

      // The median, not the mean: one scheduling hiccup must not decide this.
      return samples.sort((a, b) => a - b)[Math.floor(samples.length / 2)];
    };

    const real = await measure(payload.email);
    const fake = await measure(ABSENT);
    const ratio = Math.max(real, fake) / Math.max(Math.min(real, fake), 0.001);

    expect(ratio).toBeLessThan(10);
  });

  it('never answers 404 or a different code for an unknown address', async () => {
    const response = await forgot(ABSENT);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.message).not.toMatch(/not found|no account|unknown/i);
  });

  it('is equally quiet about a soft deleted account', async () => {
    const { payload, accessToken } = await registerUser(app);

    await request(app)
      .delete(`${AUTH_BASE}/me`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ password: payload.password });
    resetAuthRateLimiters();

    const deleted = await forgot(payload.email);
    const fake = await forgot(ABSENT);

    expect(deleted.status).toBe(200);
    expect(deleted.body).toEqual(fake.body);
  });
});
