import { Types } from 'mongoose';
import request from 'supertest';
import { resetAuthRateLimiters } from '@/middleware/rateLimit';
import { User } from '@/models/User';
import { clearMailQueue, queuedMail, type MailKind } from '@/services/mailer.service';
import { AUTH_BASE, buildTestApp, registerUser } from './helpers/factories';
import { useTestDatabase } from './helpers/testDb';

useTestDatabase();

const app = buildTestApp();

beforeEach(() => {
  resetAuthRateLimiters();
  clearMailQueue();
});

/** The plaintext token out of the most recent message of a kind. */
function tokenFromMail(kind: MailKind): string {
  const mail = [...queuedMail()].reverse().find((entry) => entry.kind === kind);

  if (!mail) throw new Error(`No ${kind} mail was queued`);

  const match = /token=([\w-]+)/.exec(mail.text);

  if (!match) throw new Error(`No token in the ${kind} mail`);

  return match[1];
}

/**
 * The stored document straight off the driver, bypassing the model. `select:
 * false` and `toJSON` both hide these fields, so reading through Mongoose would
 * make the assertion pass without proving anything about what is on disk.
 */
async function readRawUser(userId: string): Promise<Record<string, unknown>> {
  const raw = await User.collection.findOne({ _id: new Types.ObjectId(userId) });

  if (!raw) throw new Error('The user is not in the database');

  return raw;
}

describe('email verification tokens', () => {
  it('confirms the address, once', async () => {
    await registerUser(app);
    const token = tokenFromMail('verify_email');

    const first = await request(app).post(`${AUTH_BASE}/verify-email`).send({ token });
    expect(first.status).toBe(200);
    expect(first.body.data.user.emailVerified).toBe(true);

    // Single use: the token was cleared off the document by the first call.
    const second = await request(app).post(`${AUTH_BASE}/verify-email`).send({ token });
    expect(second.status).toBe(400);
    expect(second.body.code).toBe('INVALID_TOKEN');
  });

  it('refuses a token past its window even though it is otherwise valid', async () => {
    const { userId } = await registerUser(app);
    const token = tokenFromMail('verify_email');

    await User.updateOne(
      { _id: userId },
      { $set: { emailVerificationExpires: new Date(Date.now() - 1000) } },
    );

    const response = await request(app).post(`${AUTH_BASE}/verify-email`).send({ token });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('TOKEN_EXPIRED');

    const user = await User.findById(userId);
    expect(user?.emailVerified).toBe(false);
  });

  it('stores only the hash, never the token itself', async () => {
    const { userId } = await registerUser(app);
    const token = tokenFromMail('verify_email');

    // Read the raw document, not the model's projection, so nothing is hidden
    // by `select: false` or by `toJSON`.
    const raw = await readRawUser(userId);

    expect(JSON.stringify(raw)).not.toContain(token);
    expect(raw.emailVerificationTokenHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('refuses an unknown token', async () => {
    const response = await request(app)
      .post(`${AUTH_BASE}/verify-email`)
      .send({ token: 'not-a-real-token' });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('INVALID_TOKEN');
  });
});

describe('password reset tokens', () => {
  const NEW_PASSWORD = 'Replacement1';

  async function requestReset(email: string): Promise<string> {
    const response = await request(app).post(`${AUTH_BASE}/forgot-password`).send({ email });
    expect(response.status).toBe(200);

    // The token write deliberately happens after the response is sent, so the
    // route's latency cannot reveal whether the account exists. Poll for it
    // rather than assuming a particular number of ticks has passed.
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (queuedMail().some((mail) => mail.kind === 'password_reset')) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    return tokenFromMail('password_reset');
  }

  it('resets the password, once', async () => {
    const { payload } = await registerUser(app);
    const token = await requestReset(payload.email);

    const first = await request(app)
      .post(`${AUTH_BASE}/reset-password`)
      .send({ token, password: NEW_PASSWORD });
    expect(first.status).toBe(200);

    const second = await request(app)
      .post(`${AUTH_BASE}/reset-password`)
      .send({ token, password: 'AnotherOne1' });
    expect(second.status).toBe(400);
    expect(second.body.code).toBe('INVALID_TOKEN');

    // The first reset really took, and the second really did not.
    const signIn = await request(app)
      .post(`${AUTH_BASE}/login`)
      .send({ email: payload.email, password: NEW_PASSWORD });
    expect(signIn.status).toBe(200);
  });

  it('refuses a token past its 30 minute window', async () => {
    const { payload, userId } = await registerUser(app);
    const token = await requestReset(payload.email);

    await User.updateOne(
      { _id: userId },
      { $set: { passwordResetExpires: new Date(Date.now() - 1000) } },
    );

    const response = await request(app)
      .post(`${AUTH_BASE}/reset-password`)
      .send({ token, password: NEW_PASSWORD });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('TOKEN_EXPIRED');

    // The old password still works, so nothing was half applied.
    const signIn = await request(app)
      .post(`${AUTH_BASE}/login`)
      .send({ email: payload.email, password: payload.password });
    expect(signIn.status).toBe(200);
  });

  it('stores only the hash, never the token itself', async () => {
    const { payload, userId } = await registerUser(app);
    const token = await requestReset(payload.email);

    const raw = await readRawUser(userId);

    expect(JSON.stringify(raw)).not.toContain(token);
    expect(raw.passwordResetTokenHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('revokes every session and mails a confirmation', async () => {
    const { payload, userId } = await registerUser(app);
    const token = await requestReset(payload.email);

    await request(app).post(`${AUTH_BASE}/reset-password`).send({ token, password: NEW_PASSWORD });

    const { RefreshToken } = await import('@/models/RefreshToken');
    const live = await RefreshToken.countDocuments({ user: userId, revokedAt: null });
    expect(live).toBe(0);

    expect(queuedMail().some((mail) => mail.kind === 'password_changed')).toBe(true);
  });
});
