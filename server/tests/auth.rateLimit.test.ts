import request from 'supertest';
import { AUTH_ATTEMPT_LIMIT, resetAuthRateLimiters } from '@/middleware/rateLimit';
import { AUTH_BASE, buildRegisterPayload, buildTestApp, registerUser } from './helpers/factories';
import { useTestDatabase } from './helpers/testDb';

useTestDatabase();

const app = buildTestApp();

beforeEach(() => {
  resetAuthRateLimiters();
});

const attemptLogin = (email: string, ip: string): request.Test =>
  request(app)
    .post(`${AUTH_BASE}/login`)
    .set('X-Forwarded-For', ip)
    .send({ email, password: 'DefinitelyWr0ng' });

describe('auth rate limiting', () => {
  describe('keyed on IP', () => {
    it('blocks the sixth attempt from one address even when every email differs', async () => {
      const ip = '198.51.100.7';

      for (let attempt = 0; attempt < AUTH_ATTEMPT_LIMIT; attempt += 1) {
        const response = await attemptLogin(`victim-${String(attempt)}@example.com`, ip);
        expect(response.status).toBe(401);
      }

      const blocked = await attemptLogin('one-more@example.com', ip);

      expect(blocked.status).toBe(429);
      expect(blocked.body.code).toBe('RATE_LIMITED_IP');
    });

    it('does not penalise a different address', async () => {
      const ip = '198.51.100.8';

      for (let attempt = 0; attempt <= AUTH_ATTEMPT_LIMIT; attempt += 1) {
        await attemptLogin(`victim-${String(attempt)}@example.com`, ip);
      }

      const other = await attemptLogin('someone@example.com', '198.51.100.9');

      expect(other.status).toBe(401);
    });
  });

  describe('keyed on email', () => {
    it('blocks the sixth attempt on one account even when every address differs', async () => {
      const email = 'target@example.com';

      for (let attempt = 0; attempt < AUTH_ATTEMPT_LIMIT; attempt += 1) {
        const response = await attemptLogin(email, `203.0.113.${String(attempt + 20)}`);
        expect(response.status).toBe(401);
      }

      const blocked = await attemptLogin(email, '203.0.113.99');

      expect(blocked.status).toBe(429);
      expect(blocked.body.code).toBe('RATE_LIMITED_EMAIL');
    });

    it('treats differently cased addresses as the same account', async () => {
      const email = 'CaseTarget@Example.com';

      for (let attempt = 0; attempt < AUTH_ATTEMPT_LIMIT; attempt += 1) {
        await attemptLogin(
          attempt % 2 === 0 ? email : email.toLowerCase(),
          `203.0.113.${String(attempt + 40)}`,
        );
      }

      const blocked = await attemptLogin(email.toUpperCase(), '203.0.113.98');

      expect(blocked.status).toBe(429);
      expect(blocked.body.code).toBe('RATE_LIMITED_EMAIL');
    });

    it('does not penalise a different account', async () => {
      for (let attempt = 0; attempt <= AUTH_ATTEMPT_LIMIT; attempt += 1) {
        await attemptLogin('busy@example.com', `203.0.113.${String(attempt + 60)}`);
      }

      const other = await attemptLogin('quiet@example.com', '203.0.113.97');

      expect(other.status).toBe(401);
    });
  });

  describe('registration', () => {
    it('limits repeated sign-ups from one address', async () => {
      for (let attempt = 0; attempt < AUTH_ATTEMPT_LIMIT; attempt += 1) {
        await request(app)
          .post(`${AUTH_BASE}/register`)
          .set('X-Forwarded-For', '192.0.2.44')
          .send(buildRegisterPayload());
      }

      const blocked = await request(app)
        .post(`${AUTH_BASE}/register`)
        .set('X-Forwarded-For', '192.0.2.44')
        .send(buildRegisterPayload());

      expect(blocked.status).toBe(429);
      expect(blocked.body.code).toBe('RATE_LIMITED_IP');
    });
  });

  it('counts an invalid body against the budget, so validation cannot be used to bypass it', async () => {
    const ip = '192.0.2.77';
    const { payload } = await registerUser(app);
    resetAuthRateLimiters();

    for (let attempt = 0; attempt < AUTH_ATTEMPT_LIMIT; attempt += 1) {
      const response = await request(app)
        .post(`${AUTH_BASE}/login`)
        .set('X-Forwarded-For', ip)
        .send({ email: 'malformed', password: '' });
      expect(response.status).toBe(400);
    }

    const blocked = await request(app)
      .post(`${AUTH_BASE}/login`)
      .set('X-Forwarded-For', ip)
      .send({ email: payload.email, password: payload.password });

    expect(blocked.status).toBe(429);
  });
});
