import request from 'supertest';
import { runReminderSweep } from '@/jobs/reminderJob';
import { signUnsubscribeToken, verifyUnsubscribeToken } from '@/mail/unsubscribe';
import { Reminder } from '@/models/Reminder';
import { User } from '@/models/User';
import { clearMailQueue, mailQueueIdle, queuedMail, resetMailer } from '@/services/mailer.service';
import { AUTH_BASE, buildTestApp, registerUser, useCleanAuthRateLimits } from './helpers/factories';
import { useTestDatabase } from './helpers/testDb';

/**
 * The unsubscribe link SPEC section 13 requires on non-transactional mail.
 *
 * The property that matters is that it works *without a session*, since the
 * person clicking it is by definition not signing in to do so — and that it can
 * only ever subtract, never grant anything.
 */

useTestDatabase();
useCleanAuthRateLimits();

const app = buildTestApp();

const UNSUBSCRIBE = '/api/v1/email/unsubscribe';
const KL = 'Asia/Kuala_Lumpur';
const KL_SEND_UTC = new Date('2026-03-09T00:00:00Z');
const LONG_DUE = new Date('2026-01-01T00:00:00Z');

beforeEach(() => {
  resetMailer();
  clearMailQueue();
});

describe('the token', () => {
  it('round trips through signing and verification', () => {
    const token = signUnsubscribeToken('507f1f77bcf86cd799439011', 'reminders');

    expect(verifyUnsubscribeToken(token)).toEqual({
      userId: '507f1f77bcf86cd799439011',
      category: 'reminders',
    });
  });

  it('rejects a tampered signature', () => {
    const token = signUnsubscribeToken('507f1f77bcf86cd799439011', 'reminders');
    const [userId, category, signature] = token.split('.');
    const flipped = `${signature.slice(0, -1)}${signature.at(-1) === 'A' ? 'B' : 'A'}`;

    expect(verifyUnsubscribeToken(`${userId}.${category}.${flipped}`)).toBeNull();
  });

  it('rejects a token whose account was swapped for another', () => {
    const token = signUnsubscribeToken('507f1f77bcf86cd799439011', 'reminders');
    const signature = token.split('.')[2];

    // The signature covers the account and the category together, so lifting one
    // off someone else's link does not let you unsubscribe them.
    expect(verifyUnsubscribeToken(`507f1f77bcf86cd799439012.reminders.${signature}`)).toBeNull();
  });

  it('rejects a token whose category was swapped', () => {
    const token = signUnsubscribeToken('507f1f77bcf86cd799439011', 'reminders');
    const signature = token.split('.')[2];

    expect(
      verifyUnsubscribeToken(`507f1f77bcf86cd799439011.weekly_summary.${signature}`),
    ).toBeNull();
  });

  it('rejects nonsense outright', () => {
    expect(verifyUnsubscribeToken('')).toBeNull();
    expect(verifyUnsubscribeToken('not-a-token')).toBeNull();
    expect(verifyUnsubscribeToken('a.b.c.d')).toBeNull();
    expect(verifyUnsubscribeToken('507f1f77bcf86cd799439011.marketing.sig')).toBeNull();
  });
});

describe('following the link from a digest', () => {
  it('turns reminder emails off with no session at all', async () => {
    const registered = await registerUser(app, { timezone: KL });
    const token = signUnsubscribeToken(registered.userId, 'reminders');

    // No Authorization header anywhere in this request.
    const response = await request(app).get(UNSUBSCRIBE).query({ token });

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.text).toContain('You are unsubscribed');

    const user = await User.findById(registered.userId);
    expect(user?.emailRemindersEnabled).toBe(false);
  });

  it('turns the weekly summary off without touching reminders', async () => {
    const registered = await registerUser(app, { timezone: KL });
    await User.updateOne({ _id: registered.userId }, { $set: { weeklySummaryEnabled: true } });

    await request(app)
      .get(UNSUBSCRIBE)
      .query({ token: signUnsubscribeToken(registered.userId, 'weekly_summary') });

    const user = await User.findById(registered.userId);
    expect(user?.weeklySummaryEnabled).toBe(false);
    expect(user?.emailRemindersEnabled).toBe(true);
  });

  it('is idempotent', async () => {
    const registered = await registerUser(app, { timezone: KL });
    const token = signUnsubscribeToken(registered.userId, 'reminders');

    await request(app).get(UNSUBSCRIBE).query({ token });
    const second = await request(app).get(UNSUBSCRIBE).query({ token });

    expect(second.status).toBe(200);
    const user = await User.findById(registered.userId);
    expect(user?.emailRemindersEnabled).toBe(false);
  });

  it('answers 400 for a token this server did not sign', async () => {
    const response = await request(app)
      .get(UNSUBSCRIBE)
      .query({ token: '507f1f77bcf86cd799439011.reminders.forged' });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('INVALID_TOKEN');
  });

  it('answers 400 when the token is missing entirely', async () => {
    const response = await request(app).get(UNSUBSCRIBE);

    expect(response.status).toBe(400);
  });

  it('does not disclose whether the account exists', async () => {
    // A well-formed token for an account that is not there answers exactly as a
    // real one does, so the link is not an existence oracle.
    const response = await request(app)
      .get(UNSUBSCRIBE)
      .query({ token: signUnsubscribeToken('507f1f77bcf86cd799439099', 'reminders') });

    expect(response.status).toBe(200);
    expect(response.text).toContain('You are unsubscribed');
  });
});

describe('the RFC 8058 one-click endpoint', () => {
  it('answers in the standard envelope and applies the change', async () => {
    const registered = await registerUser(app, { timezone: KL });

    const response = await request(app)
      .post(UNSUBSCRIBE)
      .query({ token: signUnsubscribeToken(registered.userId, 'reminders') })
      .send('List-Unsubscribe=One-Click');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.category).toBe('reminders');

    const user = await User.findById(registered.userId);
    expect(user?.emailRemindersEnabled).toBe(false);
  });
});

describe('a digest carries a link that actually works', () => {
  async function seedReminder(user: string, title: string): Promise<void> {
    await Reminder.create({ user, type: 'deadline', title, dueAt: LONG_DUE, channel: 'email' });
  }

  it('stops the next digest when the link in the last one is followed', async () => {
    const registered = await registerUser(app, { timezone: KL });
    await seedReminder(registered.userId, 'Application deadline');

    await runReminderSweep(KL_SEND_UTC);
    await mailQueueIdle();

    const digest = [...queuedMail()].reverse().find((mail) => mail.kind === 'reminder_digest');
    const link = /unsubscribe\?token=([^\s"<]+)/.exec(digest?.text ?? '')?.[1];
    expect(link).toBeDefined();

    // End to end: pull the token straight out of the email that was sent.
    const followed = await request(app)
      .get(UNSUBSCRIBE)
      .query({ token: decodeURIComponent(String(link)) });
    expect(followed.status).toBe(200);

    clearMailQueue();
    await seedReminder(registered.userId, 'Another deadline');
    await runReminderSweep(new Date('2026-03-16T00:00:00Z'));
    await mailQueueIdle();

    expect(queuedMail().filter((mail) => mail.kind === 'reminder_digest')).toHaveLength(0);
  });

  it('sets the one-click headers on the digest', async () => {
    const registered = await registerUser(app, { timezone: KL });
    await seedReminder(registered.userId, 'Application deadline');

    await runReminderSweep(KL_SEND_UTC);
    await mailQueueIdle();

    const digest = [...queuedMail()].reverse().find((mail) => mail.kind === 'reminder_digest');

    expect(digest?.headers['List-Unsubscribe']).toMatch(/^<https?:\/\/.+unsubscribe\?token=.+>$/);
    expect(digest?.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  });
});

describe('unsubscribing does not touch security mail', () => {
  it('still sends the password changed email afterwards', async () => {
    const registered = await registerUser(app, { timezone: KL });

    await request(app)
      .get(UNSUBSCRIBE)
      .query({ token: signUnsubscribeToken(registered.userId, 'reminders') });

    clearMailQueue();

    await request(app)
      .patch(`${AUTH_BASE}/me/password`)
      .set('Authorization', `Bearer ${registered.accessToken}`)
      .send({ currentPassword: registered.payload.password, newPassword: 'An0therStr0ngPass' });

    await mailQueueIdle();

    expect(queuedMail().some((mail) => mail.kind === 'password_changed')).toBe(true);
  });
});
