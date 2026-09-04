import request from 'supertest';
import { MAIL_MAX_ATTEMPTS } from '@/mail/queue';
import type { MailTransport, OutgoingMessage } from '@/mail/transport';
import {
  clearMailQueue,
  configureMailer,
  mailQueueIdle,
  queuedMail,
  resetMailer,
} from '@/services/mailer.service';
import {
  AUTH_BASE,
  buildRegisterPayload,
  buildTestApp,
  registerUser,
  useCleanAuthRateLimits,
} from './helpers/factories';
import { useTestDatabase } from './helpers/testDb';

/**
 * SPEC section 13: "A failed email must never fail the HTTP request that
 * triggered it."
 *
 * The mechanism is that `sendMail` is synchronous, returns nothing, and hands
 * the caller no promise — so a controller cannot await delivery even by mistake.
 * These cases prove the consequence from the outside: with a transport that
 * fails every attempt, the endpoints still answer normally, and they answer
 * *before* the retries have finished rather than after.
 */

useTestDatabase();
useCleanAuthRateLimits();

const app = buildTestApp();

interface ControlledTransport {
  attempts: OutgoingMessage[];
  /** Resolves once the transport has been called at least once. */
  firstAttempt: Promise<void>;
  /** Opens the held backoff, and keeps it open, so the retries can run out. */
  release: () => void;
}

/**
 * A transport that always rejects, and whose backoff is held open until the test
 * chooses to release it. Holding the delay is what makes "mid-retry" a state
 * that can be asserted against rather than a race.
 *
 * `release` is sticky: it resolves the gate currently held *and* stops new ones
 * being created, because each further failed attempt would otherwise park on a
 * fresh gate that nobody is left to open.
 */
function failingTransport(): ControlledTransport {
  const attempts: OutgoingMessage[] = [];
  const gates: (() => void)[] = [];
  let released = false;

  let announceFirstAttempt: () => void = () => undefined;
  const firstAttempt = new Promise<void>((resolve) => {
    announceFirstAttempt = resolve;
  });

  const transport: MailTransport = {
    mode: 'console',
    send(message: OutgoingMessage): Promise<void> {
      attempts.push(message);
      announceFirstAttempt();
      return Promise.reject(new Error('relay refused the connection'));
    },
  };

  configureMailer({
    transport,
    delay: () => {
      if (released) return Promise.resolve();

      return new Promise<void>((resolve) => {
        gates.push(resolve);
      });
    },
  });

  return {
    attempts,
    firstAttempt,
    release: () => {
      released = true;
      while (gates.length > 0) gates.shift()?.();
    },
  };
}

beforeEach(() => {
  clearMailQueue();
});

afterEach(() => {
  resetMailer();
});

describe('registration while the mail transport is failing', () => {
  it('returns 201 even though the first send attempt has already failed', async () => {
    const mail = failingTransport();
    const payload = buildRegisterPayload();

    const response = await request(app).post(`${AUTH_BASE}/register`).send(payload);

    // The account exists and the caller is signed in; nothing about the mail
    // reached the response.
    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.data.user.email).toBe(payload.email);

    mail.release();
    await mailQueueIdle();
  });

  it('answers while the email is still mid-retry, not after it finishes', async () => {
    const mail = failingTransport();

    const response = await request(app).post(`${AUTH_BASE}/register`).send(buildRegisterPayload());
    await mail.firstAttempt;

    expect(response.status).toBe(201);
    // The queue is parked in its backoff: it has tried at least once and has not
    // yet exhausted its attempts. The request waited for none of it.
    expect(mail.attempts.length).toBeGreaterThan(0);
    expect(mail.attempts.length).toBeLessThan(MAIL_MAX_ATTEMPTS);

    const record = queuedMail().at(-1);
    expect(record?.outcome).toBe('pending');

    mail.release();
    await mailQueueIdle();
  });

  it('still shows 201 once the retries are exhausted and the send has failed', async () => {
    const mail = failingTransport();

    const response = await request(app).post(`${AUTH_BASE}/register`).send(buildRegisterPayload());
    mail.release();
    await mailQueueIdle();

    const record = queuedMail().at(-1);

    expect(record?.outcome).toBe('failed');
    expect(record?.attempts).toBe(MAIL_MAX_ATTEMPTS);
    expect(mail.attempts).toHaveLength(MAIL_MAX_ATTEMPTS);
    // The response was decided long before any of that, and is unchanged by it.
    expect(response.status).toBe(201);
  });

  it('leaves a usable account behind, so the failure cost only the email', async () => {
    const mail = failingTransport();
    const payload = buildRegisterPayload();

    await request(app).post(`${AUTH_BASE}/register`).send(payload);
    mail.release();
    await mailQueueIdle();

    const login = await request(app)
      .post(`${AUTH_BASE}/login`)
      .send({ email: payload.email, password: payload.password });

    expect(login.status).toBe(200);
  });
});

describe('the other mail-triggering endpoints behave the same way', () => {
  it('forgot-password still returns 200 with a dead transport', async () => {
    const registered = await registerUser(app);
    const mail = failingTransport();

    const response = await request(app)
      .post(`${AUTH_BASE}/forgot-password`)
      .send({ email: registered.payload.email });

    expect(response.status).toBe(200);

    mail.release();
    await mailQueueIdle();
  });

  it('changing a password still returns 200 with a dead transport', async () => {
    const registered = await registerUser(app);
    const mail = failingTransport();

    const response = await request(app)
      .patch(`${AUTH_BASE}/me/password`)
      .set('Authorization', `Bearer ${registered.accessToken}`)
      .send({ currentPassword: registered.payload.password, newPassword: 'An0therStr0ngPass' });

    expect(response.status).toBe(200);

    mail.release();
    await mailQueueIdle();

    // The notification was attempted and failed; the password change stands.
    const record = [...queuedMail()].reverse().find((entry) => entry.kind === 'password_changed');
    expect(record?.outcome).toBe('failed');
  });
});
