import request from 'supertest';
import { parseEnv } from '@/config/env';
import { resolveTransportMode } from '@/mail/transport';
import { clearMailQueue, mailQueueIdle, queuedMail, resetMailer } from '@/services/mailer.service';
import {
  AUTH_BASE,
  buildRegisterPayload,
  buildTestApp,
  useCleanAuthRateLimits,
} from './helpers/factories';
import { useTestDatabase } from './helpers/testDb';

/**
 * SPEC section 13 and the Definition of Done: the app must boot and register
 * successfully with **no** SMTP configuration.
 *
 * This suite is the proof rather than the assumption. `tests/setup.ts` sets no
 * `SMTP_*` or `MAIL_*` variable at all, so the whole file runs in exactly the
 * state a developer gets from a fresh clone with no `.env`: nothing configured.
 *
 * "Unconfigured" is unset *or blank*. `config/env.ts` loads the developer's
 * own `server/.env` at import time, and one copied verbatim from the example
 * carries `SMTP_HOST=`, which dotenv reads as `""`. The loader drops blanks
 * before validating (`withoutBlanks`), so that file is unconfigured too, and
 * the guard below uses the loader's definition rather than a stricter one.
 */

useTestDatabase();
useCleanAuthRateLimits();

const app = buildTestApp();

beforeEach(() => {
  resetMailer();
  clearMailQueue();
});

describe('the environment under test really is unconfigured', () => {
  it('has no SMTP variables set', () => {
    // If this ever fails, every other case in this file proves nothing.
    expect(process.env.SMTP_HOST ?? '').toBe('');
    expect(process.env.SMTP_USER ?? '').toBe('');
    expect(process.env.SMTP_PASS ?? '').toBe('');
    expect(process.env.MAIL_TRANSPORT ?? '').toBe('');
  });

  it('parses a configuration with only the three required variables', () => {
    const parsed = parseEnv({
      MONGO_URI: 'mongodb://127.0.0.1:27017/it',
      JWT_ACCESS_SECRET: 'a',
      JWT_REFRESH_SECRET: 'b',
    });

    expect(parsed.MAIL_TRANSPORT).toBeUndefined();
    expect(parsed.SMTP_HOST).toBeUndefined();
    // A default From exists so the transport can always build a message.
    expect(parsed.MAIL_FROM.length).toBeGreaterThan(0);
  });

  it('resolves to the console transport rather than failing', () => {
    expect(resolveTransportMode()).toBe('console');
  });

  it('refuses only the incoherent combination, smtp with no host', () => {
    expect(() =>
      parseEnv({
        MONGO_URI: 'mongodb://127.0.0.1:27017/it',
        JWT_ACCESS_SECRET: 'a',
        JWT_REFRESH_SECRET: 'b',
        MAIL_TRANSPORT: 'smtp',
      }),
    ).toThrow(/SMTP_HOST/);
  });
});

describe('registration with zero email configuration', () => {
  it('returns 201 and a usable session', async () => {
    const payload = buildRegisterPayload();

    const response = await request(app).post(`${AUTH_BASE}/register`).send(payload);

    expect(response.status).toBe(201);
    expect(response.body.data.user.email).toBe(payload.email);
    expect(typeof response.body.data.accessToken).toBe('string');
  });

  it('renders the verification email to the console transport, and it does not vanish', async () => {
    const payload = buildRegisterPayload();

    await request(app).post(`${AUTH_BASE}/register`).send(payload);
    await mailQueueIdle();

    const mail = [...queuedMail()].reverse().find((entry) => entry.kind === 'verify_email');

    expect(mail).toBeDefined();
    expect(mail?.to).toBe(payload.email);
    // Not merely queued — actually delivered by the console transport, on the
    // first attempt. "Sent" is what separates rendering to console from silently
    // dropping the message.
    expect(mail?.outcome).toBe('sent');
    expect(mail?.attempts).toBe(1);
    expect(mail?.error).toBeUndefined();
  });

  it('renders both bodies, with a working verification link in each', async () => {
    await request(app).post(`${AUTH_BASE}/register`).send(buildRegisterPayload());
    await mailQueueIdle();

    const mail = [...queuedMail()].reverse().find((entry) => entry.kind === 'verify_email');
    const token = /token=([\w-]+)/.exec(mail?.text ?? '')?.[1];

    expect(mail?.html).toContain('<!doctype html>');
    expect(token).toBeDefined();
    expect(mail?.html).toContain(`token=${String(token)}`);
  });

  it('produces a token that actually verifies the account', async () => {
    const payload = buildRegisterPayload();

    await request(app).post(`${AUTH_BASE}/register`).send(payload);
    await mailQueueIdle();

    const mail = [...queuedMail()].reverse().find((entry) => entry.kind === 'verify_email');
    const token = /token=([\w-]+)/.exec(mail?.text ?? '')?.[1];

    // End to end: with no SMTP anywhere, a person can still finish the flow by
    // reading the link off the console.
    const verified = await request(app).post(`${AUTH_BASE}/verify-email`).send({ token });

    expect(verified.status).toBe(200);
    expect(verified.body.data.user.emailVerified).toBe(true);
  });
});
