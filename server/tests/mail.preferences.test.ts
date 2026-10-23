import type { Types } from 'mongoose';
import request from 'supertest';
import { runReminderSweep } from '@/jobs/reminderJob';
import { runWeeklySummarySweep } from '@/jobs/weeklySummaryJob';
import { MAIL_CATEGORY, MAIL_KINDS, type MailKind } from '@/mail/types';
import { Reminder } from '@/models/Reminder';
import { User } from '@/models/User';
import { clearMailQueue, mailQueueIdle, queuedMail, resetMailer } from '@/services/mailer.service';
import {
  AUTH_BASE,
  buildTestApp,
  registerUser,
  useCleanAuthRateLimits,
  type RegisteredUser,
} from './helpers/factories';
import { useTestDatabase } from './helpers/testDb';

/**
 * SPEC section 13: every email respects `emailRemindersEnabled` except the
 * security-critical ones, which always send.
 *
 * The subject of this whole file is one account with **every optional preference
 * switched off**. The four security emails must still arrive; the two optional
 * ones must not. Little here asserts on a happy-path account, because the
 * opted-out account is the only one that can tell the two categories apart.
 */

useTestDatabase();
useCleanAuthRateLimits();

const app = buildTestApp();

const KL = 'Asia/Kuala_Lumpur';
// 08:00 local in Kuala Lumpur, and a Monday, so both sweeps are live on this tick.
const KL_SEND_UTC = new Date('2026-03-09T00:00:00Z');
const LONG_DUE = new Date('2026-01-01T00:00:00Z');

beforeEach(() => {
  resetMailer();
  clearMailQueue();
});

/** An account that has opted out of everything it is allowed to opt out of. */
async function optedOutUser(): Promise<{ registered: RegisteredUser; id: Types.ObjectId }> {
  const registered = await registerUser(app, { timezone: KL });
  const user = await User.findById(registered.userId);
  if (!user) throw new Error('user was not created');

  await User.updateOne(
    { _id: user._id },
    { $set: { emailRemindersEnabled: false, weeklySummaryEnabled: false } },
  );

  return { registered, id: user._id };
}

async function seedDueReminder(user: Types.ObjectId): Promise<void> {
  await Reminder.create({
    user,
    type: 'deadline',
    title: 'Application deadline',
    dueAt: LONG_DUE,
    channel: 'email',
  });
}

function kindsSent(): MailKind[] {
  return queuedMail().map((mail) => mail.kind);
}

describe('the two categories are exactly what SPEC section 13 describes', () => {
  it('names five security kinds, two optional ones and one operator kind', () => {
    const security = MAIL_KINDS.filter((kind) => MAIL_CATEGORY[kind] === 'security');
    const optional = MAIL_KINDS.filter((kind) => MAIL_CATEGORY[kind] === 'optional');

    expect(security).toEqual([
      'verify_email',
      'password_reset',
      'password_changed',
      'account_deleted',
      'account_restored',
    ]);
    expect(optional).toEqual(['reminder_digest', 'weekly_summary']);
    expect(MAIL_KINDS.filter((kind) => MAIL_CATEGORY[kind] === 'operator')).toEqual(['feedback']);
  });
});

describe('an account with every email preference off still gets security mail', () => {
  it('receives the verification email at registration', async () => {
    // Registration is the one security email sent before any preference can be
    // changed, so it is asserted on a fresh account rather than an opted-out one.
    const registered = await registerUser(app, { timezone: KL });
    await mailQueueIdle();

    const mail = [...queuedMail()].reverse().find((entry) => entry.kind === 'verify_email');
    expect(mail?.to).toBe(registered.payload.email);
    expect(mail?.outcome).toBe('sent');
  });

  it('receives a re-sent verification email', async () => {
    const { registered } = await optedOutUser();
    clearMailQueue();

    const response = await request(app)
      .post(`${AUTH_BASE}/resend-verification`)
      .set('Authorization', `Bearer ${registered.accessToken}`);

    await mailQueueIdle();

    expect(response.status).toBe(200);
    expect(kindsSent()).toContain('verify_email');
  });

  it('receives the password reset email', async () => {
    const { registered } = await optedOutUser();
    clearMailQueue();

    await request(app)
      .post(`${AUTH_BASE}/forgot-password`)
      .send({ email: registered.payload.email });

    // The reset is issued *after* the response is written — that is what removes
    // the timing difference between a real and a fictional address — so the
    // queue has to be waited on rather than assumed. Same shape as the wait in
    // `auth.lockout.test.ts`: a handful of microtasks is not enough once the
    // whole suite is sharing one process.
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (queuedMail().some((mail) => mail.kind === 'password_reset')) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    await mailQueueIdle();

    const mail = [...queuedMail()].reverse().find((entry) => entry.kind === 'password_reset');
    expect(mail?.to).toBe(registered.payload.email);
    expect(mail?.outcome).toBe('sent');
  });

  it('receives the password changed email', async () => {
    const { registered } = await optedOutUser();
    clearMailQueue();

    const response = await request(app)
      .patch(`${AUTH_BASE}/me/password`)
      .set('Authorization', `Bearer ${registered.accessToken}`)
      .send({ currentPassword: registered.payload.password, newPassword: 'An0therStr0ngPass' });

    await mailQueueIdle();

    expect(response.status).toBe(200);
    const mail = [...queuedMail()].reverse().find((entry) => entry.kind === 'password_changed');
    expect(mail?.to).toBe(registered.payload.email);
    expect(mail?.outcome).toBe('sent');
  });

  it('receives the account closure email', async () => {
    const { registered } = await optedOutUser();
    clearMailQueue();

    const response = await request(app)
      .delete(`${AUTH_BASE}/me`)
      .set('Authorization', `Bearer ${registered.accessToken}`)
      .send({ password: registered.payload.password });

    await mailQueueIdle();

    expect(response.status).toBe(200);
    const mail = [...queuedMail()].reverse().find((entry) => entry.kind === 'account_deleted');
    expect(mail?.to).toBe(registered.payload.email);
    expect(mail?.outcome).toBe('sent');
  });

  it('never carries an unsubscribe link on any of them', async () => {
    const { registered } = await optedOutUser();
    clearMailQueue();

    await request(app)
      .patch(`${AUTH_BASE}/me/password`)
      .set('Authorization', `Bearer ${registered.accessToken}`)
      .send({ currentPassword: registered.payload.password, newPassword: 'An0therStr0ngPass' });

    await mailQueueIdle();

    const mail = [...queuedMail()].reverse().find((entry) => entry.kind === 'password_changed');
    expect(mail?.text).not.toContain('Unsubscribe');
    expect(mail?.headers['List-Unsubscribe']).toBeUndefined();
  });
});

describe('an account with every email preference off gets no optional mail', () => {
  it('receives no reminder digest, even with reminders due at its local hour', async () => {
    const { id } = await optedOutUser();
    await seedDueReminder(id);
    clearMailQueue();

    await runReminderSweep(KL_SEND_UTC);
    await mailQueueIdle();

    expect(kindsSent()).not.toContain('reminder_digest');
  });

  it('receives no weekly summary on its local summary morning', async () => {
    await optedOutUser();
    clearMailQueue();

    await runWeeklySummarySweep(KL_SEND_UTC);
    await mailQueueIdle();

    expect(kindsSent()).not.toContain('weekly_summary');
  });

  it('gets no optional mail of any kind across both sweeps', async () => {
    const { id } = await optedOutUser();
    await seedDueReminder(id);
    clearMailQueue();

    await runReminderSweep(KL_SEND_UTC);
    await runWeeklySummarySweep(KL_SEND_UTC);
    await mailQueueIdle();

    const optional = kindsSent().filter((kind) => MAIL_CATEGORY[kind] === 'optional');
    expect(optional).toEqual([]);
  });
});

describe('the two optional streams are independent of one another', () => {
  async function subscriber(reminders: boolean, summary: boolean): Promise<Types.ObjectId> {
    const registered = await registerUser(app, { timezone: KL });
    const user = await User.findById(registered.userId);
    if (!user) throw new Error('user was not created');

    await User.updateOne(
      { _id: user._id },
      { $set: { emailRemindersEnabled: reminders, weeklySummaryEnabled: summary } },
    );

    return user._id;
  }

  it('sends the digest but not the summary when only reminders are on', async () => {
    await seedDueReminder(await subscriber(true, false));
    clearMailQueue();

    await runReminderSweep(KL_SEND_UTC);
    await runWeeklySummarySweep(KL_SEND_UTC);
    await mailQueueIdle();

    expect(kindsSent()).toContain('reminder_digest');
    expect(kindsSent()).not.toContain('weekly_summary');
  });

  it('sends the summary but not the digest when only the summary is on', async () => {
    await seedDueReminder(await subscriber(false, true));
    clearMailQueue();

    await runReminderSweep(KL_SEND_UTC);
    await runWeeklySummarySweep(KL_SEND_UTC);
    await mailQueueIdle();

    expect(kindsSent()).toContain('weekly_summary');
    expect(kindsSent()).not.toContain('reminder_digest');
  });
});

describe('the weekly summary is opt-in rather than opt-out', () => {
  it('is off on a newly registered account', async () => {
    const registered = await registerUser(app);
    const user = await User.findById(registered.userId);

    expect(user?.weeklySummaryEnabled).toBe(false);
    // Reminders, by contrast, are on by default — they are the product working.
    expect(user?.emailRemindersEnabled).toBe(true);
  });

  it('can be switched on through the profile patch', async () => {
    const registered = await registerUser(app);

    const response = await request(app)
      .patch(`${AUTH_BASE}/me`)
      .set('Authorization', `Bearer ${registered.accessToken}`)
      .send({ weeklySummaryEnabled: true });

    expect(response.status).toBe(200);
    expect(response.body.data.user.weeklySummaryEnabled).toBe(true);
  });
});
