import { Types } from 'mongoose';
import request from 'supertest';
import { PURGE_AFTER_MS, purgeDeletedUsers } from '@/jobs/purgeDeletedUsersJob';
import { resetAuthRateLimiters } from '@/middleware/rateLimit';
import { Application } from '@/models/Application';
import { Reminder } from '@/models/Reminder';
import { User } from '@/models/User';
import { clearMailQueue, queuedMail } from '@/services/mailer.service';
import { hashSingleUseToken } from '@/utils/singleUseToken';
import {
  APPLICATIONS_BASE,
  AUTH_BASE,
  buildTestApp,
  extractRefreshCookie,
  registerUser,
  type RegisteredUser,
} from './helpers/factories';
import { useTestDatabase } from './helpers/testDb';

useTestDatabase();

const app = buildTestApp();
const MS_PER_DAY = 86_400_000;

beforeEach(() => {
  resetAuthRateLimiters();
  clearMailQueue();
});

function login(email: string, password: string): request.Test {
  return request(app).post(`${AUTH_BASE}/login`).send({ email, password });
}

function restore(restoreToken: string): request.Test {
  return request(app).post(`${AUTH_BASE}/restore`).send({ restoreToken });
}

async function closeAccount(user: RegisteredUser): Promise<void> {
  const response = await request(app)
    .delete(`${AUTH_BASE}/me`)
    .set('Authorization', `Bearer ${user.accessToken}`)
    .send({ password: user.payload.password });

  expect(response.status).toBe(200);
  resetAuthRateLimiters();
}

/** Moves the closure into the past, as if the account had been closed `days` ago. */
async function closedDaysAgo(userId: string, days: number): Promise<Date> {
  const deletedAt = new Date(Date.now() - days * MS_PER_DAY);
  await User.updateOne({ _id: userId }, { $set: { deletedAt } });
  return deletedAt;
}

/** Signs in to a closed account and returns the restore prompt it gets. */
async function restorePrompt(user: RegisteredUser): Promise<{ purgeAt: string; token: string }> {
  const response = await login(user.payload.email, user.payload.password);

  expect(response.status).toBe(409);
  expect(response.body.code).toBe('ACCOUNT_PENDING_DELETION');

  return { purgeAt: response.body.errors.purgeAt, token: response.body.errors.restoreToken };
}

/** The error envelope minus what legitimately differs per request. */
function comparable(body: Record<string, unknown>): Record<string, unknown> {
  const { requestId: _requestId, stack: _stack, ...rest } = body;
  return rest;
}

describe('signing in to a closed account', () => {
  it('offers a restore with the date the window ends, and creates no session', async () => {
    const user = await registerUser(app);
    await closeAccount(user);
    const deletedAt = await closedDaysAgo(user.userId, 3);

    const response = await login(user.payload.email, user.payload.password);

    expect(response.status).toBe(409);
    expect(response.body.errors.purgeAt).toBe(
      new Date(deletedAt.getTime() + PURGE_AFTER_MS).toISOString(),
    );
    expect(typeof response.body.errors.restoreToken).toBe('string');
    expect(response.headers['set-cookie']).toBeUndefined();

    // Only the digest is stored, never the token itself.
    const stored = await User.findById(user.userId).select('+restoreTokenHash');
    expect(stored?.restoreTokenHash).toBe(hashSingleUseToken(response.body.errors.restoreToken));
    expect(stored?.restoreTokenHash).not.toBe(response.body.errors.restoreToken);
  });

  it('answers a wrong password exactly as it answers an unknown email', async () => {
    const user = await registerUser(app);
    await closeAccount(user);

    const closed = await login(user.payload.email, 'NotThePassword1');
    resetAuthRateLimiters();
    const absent = await login('nobody-here@example.com', 'NotThePassword1');

    expect(closed.status).toBe(401);
    expect(absent.status).toBe(closed.status);
    expect(comparable(closed.body)).toEqual(comparable(absent.body));
    expect(closed.headers['content-type']).toBe(absent.headers['content-type']);
  });

  it('costs the same order of time for a wrong password as for an unknown email', async () => {
    const user = await registerUser(app);
    await closeAccount(user);

    const measure = async (email: string): Promise<number> => {
      const samples: number[] = [];
      for (let i = 0; i < 5; i += 1) {
        const started = performance.now();
        await login(email, 'NotThePassword1');
        samples.push(performance.now() - started);
        resetAuthRateLimiters();
      }
      return samples.sort((a, b) => a - b)[Math.floor(samples.length / 2)];
    };

    // Both paths run one bcrypt comparison; warm them before measuring.
    await measure(user.payload.email);
    await User.updateOne({ _id: user.userId }, { $set: { failedLoginAttempts: 0 } });

    const closed = await measure(user.payload.email);
    const absent = await measure('nobody-here@example.com');

    expect(Math.max(closed, absent) / Math.max(Math.min(closed, absent), 0.001)).toBeLessThan(10);
  });

  it('refuses with 410 once the 30 day window has passed, even before the purge runs', async () => {
    const user = await registerUser(app);
    await closeAccount(user);
    await closedDaysAgo(user.userId, 31);

    const response = await login(user.payload.email, user.payload.password);

    expect(response.status).toBe(410);
    expect(response.body.code).toBe('ACCOUNT_PURGED');
    expect(response.body.message).toMatch(/more than 30 days ago/);
    expect(response.body.errors).toBeUndefined();
    expect(response.headers['set-cookie']).toBeUndefined();
  });
});

describe('an active account', () => {
  it('signs in exactly as before, with nothing about restoring in the response', async () => {
    const user = await registerUser(app);

    const response = await login(user.payload.email, user.payload.password);

    expect(response.status).toBe(200);
    expect(typeof response.body.data.accessToken).toBe('string');
    expect(extractRefreshCookie(response)).toBeTruthy();
    expect(response.body.data.user).not.toHaveProperty('restoreTokenHash');
    expect(response.body.data.user).not.toHaveProperty('restoreTokenExpires');
    expect(response.body.data.user).not.toHaveProperty('deletedAt');
  });

  it('still gets 401 for a wrong password', async () => {
    const user = await registerUser(app);

    const response = await login(user.payload.email, 'NotThePassword1');

    expect(response.status).toBe(401);
    expect(response.body.code).toBe('INVALID_CREDENTIALS');
  });
});

describe('POST /auth/restore', () => {
  it('reopens the account with its data intact and signs it in', async () => {
    const user = await registerUser(app);
    await request(app)
      .post(APPLICATIONS_BASE)
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({ company: 'Kept Ltd', role: 'Backend Intern' });
    await closeAccount(user);
    const { token } = await restorePrompt(user);
    clearMailQueue();

    const response = await restore(token);

    expect(response.status).toBe(200);
    expect(response.body.data.user.email).toBe(user.payload.email);
    expect(extractRefreshCookie(response)).toBeTruthy();

    const stored = await User.findById(user.userId).select('+restoreTokenHash');
    expect(stored?.deletedAt).toBeUndefined();
    expect(stored?.restoreTokenHash).toBeUndefined();
    expect(await Application.countDocuments({ user: user.userId, company: 'Kept Ltd' })).toBe(1);

    const me = await request(app)
      .get(`${AUTH_BASE}/me`)
      .set('Authorization', `Bearer ${response.body.data.accessToken}`);
    expect(me.status).toBe(200);

    expect(queuedMail().some((mail) => mail.kind === 'account_restored')).toBe(true);
  });

  it('marks reminders that came due while closed as sent, and leaves the rest alone', async () => {
    const user = await registerUser(app);
    const owner = new Types.ObjectId(user.userId);
    await closeAccount(user);
    await closedDaysAgo(user.userId, 5);

    const reminder = (title: string, daysFromNow: number) => ({
      user: owner,
      type: 'custom' as const,
      channel: 'email' as const,
      title,
      dueAt: new Date(Date.now() + daysFromNow * MS_PER_DAY),
    });
    await Reminder.create([
      reminder('Before closing', -6),
      reminder('While closed', -2),
      reminder('Still ahead', 3),
    ]);

    const { token } = await restorePrompt(user);
    expect((await restore(token)).status).toBe(200);

    const sent = async (title: string): Promise<boolean | undefined> =>
      (await Reminder.findOne({ user: owner, title }))?.sent;
    expect(await sent('While closed')).toBe(true);
    expect(await sent('Before closing')).toBe(false);
    expect(await sent('Still ahead')).toBe(false);
  });

  it('keeps every session from before the closure revoked', async () => {
    const user = await registerUser(app);
    const secondDevice = await login(user.payload.email, user.payload.password);
    const oldCookies = [user.refreshCookie, extractRefreshCookie(secondDevice)];
    await closeAccount(user);

    const { token } = await restorePrompt(user);
    const restored = await restore(token);
    expect(restored.status).toBe(200);

    for (const cookie of oldCookies) {
      const refreshed = await request(app).post(`${AUTH_BASE}/refresh`).set('Cookie', cookie);
      expect(refreshed.status).toBe(401);
    }

    const fresh = await request(app)
      .post(`${AUTH_BASE}/refresh`)
      .set('Cookie', extractRefreshCookie(restored));
    expect(fresh.status).toBe(200);
  });

  it('accepts a token once only', async () => {
    const user = await registerUser(app);
    await closeAccount(user);
    const { token } = await restorePrompt(user);

    expect((await restore(token)).status).toBe(200);
    const again = await restore(token);

    expect(again.status).toBe(400);
    expect(again.body.code).toBe('INVALID_TOKEN');
  });

  it('refuses a token older than 10 minutes, and forgets it', async () => {
    const user = await registerUser(app);
    await closeAccount(user);
    const { token } = await restorePrompt(user);
    await User.updateOne(
      { _id: user.userId },
      { $set: { restoreTokenExpires: new Date(Date.now() - 1000) } },
    );

    const expired = await restore(token);
    expect(expired.status).toBe(400);
    expect(expired.body.code).toBe('TOKEN_EXPIRED');

    const again = await restore(token);
    expect(again.body.code).toBe('INVALID_TOKEN');

    const stored = await User.findById(user.userId);
    expect(stored?.deletedAt).toBeInstanceOf(Date);
  });

  it('refuses with 410 when the window ends between the prompt and the restore', async () => {
    const user = await registerUser(app);
    await closeAccount(user);
    await closedDaysAgo(user.userId, 29);
    const { token } = await restorePrompt(user);
    await closedDaysAgo(user.userId, 31);

    const response = await restore(token);

    expect(response.status).toBe(410);
    expect(response.body.code).toBe('ACCOUNT_PURGED');
    expect((await User.findById(user.userId))?.deletedAt).toBeInstanceOf(Date);
  });

  it('rejects a token that was never issued', async () => {
    const response = await restore('not-a-real-token');

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('INVALID_TOKEN');
  });

  it('validates the body', async () => {
    const response = await request(app).post(`${AUTH_BASE}/restore`).send({});

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');
  });
});

describe('the purge job around a restore', () => {
  it('leaves a restored account alone, however long after', async () => {
    const user = await registerUser(app);
    await closeAccount(user);
    const { token } = await restorePrompt(user);
    await restore(token);

    const result = await purgeDeletedUsers(new Date(Date.now() + PURGE_AFTER_MS * 2));

    expect(result.users).toBe(0);
    expect(await User.findById(user.userId)).not.toBeNull();
  });

  it('still removes an account whose window has passed', async () => {
    const user = await registerUser(app);
    await closeAccount(user);
    await closedDaysAgo(user.userId, 31);

    const result = await purgeDeletedUsers();

    expect(result.users).toBe(1);
    expect(await User.findById(user.userId)).toBeNull();
  });
});
