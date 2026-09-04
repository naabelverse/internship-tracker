import type { Types } from 'mongoose';
import { runReminderSweep } from '@/jobs/reminderJob';
import { Reminder } from '@/models/Reminder';
import { User } from '@/models/User';
import { clearMailQueue, mailQueueIdle, queuedMail, resetMailer } from '@/services/mailer.service';
import { buildTestApp, registerUser, useCleanAuthRateLimits } from './helpers/factories';
import { useTestDatabase } from './helpers/testDb';

/**
 * The digest *email* fires on each recipient's own clock.
 *
 * `reminderJob.timezone.test.ts` proves the same property for selection; this
 * proves it for delivery, because Phase 12 is where a second, UTC-shaped path
 * could have been introduced. It deliberately reuses Phase 4's two-zone fixture
 * — same zones, same instants — so a regression shows up as the same shape of
 * failure in both files rather than as a new mystery in one.
 */

useTestDatabase();
useCleanAuthRateLimits();

const app = buildTestApp();

const KL = 'Asia/Kuala_Lumpur';
const LA = 'America/Los_Angeles';

// Long past, so every reminder below is due in absolute terms at every instant
// tested. What varies is only whether delivery is allowed in that UTC hour.
const LONG_DUE = new Date('2026-01-01T00:00:00Z');

// Digest hour is 08:00 local.
// Kuala Lumpur is UTC+8 all year, so 08:00 local is 00:00 UTC.
// Los Angeles is UTC-7 in summer and UTC-8 in winter, so 08:00 local moves
// between 15:00 and 16:00 UTC.
const KL_DIGEST_UTC = new Date('2026-03-10T00:00:00Z');
const LA_DIGEST_UTC_SUMMER = new Date('2026-03-10T15:00:00Z');
const LA_DIGEST_UTC_WINTER = new Date('2026-01-10T16:00:00Z');

beforeEach(() => {
  resetMailer();
  clearMailQueue();
});

async function seedUser(timeZone: string): Promise<{ id: Types.ObjectId; email: string }> {
  const registered = await registerUser(app, { timezone: timeZone });
  const user = await User.findById(registered.userId);
  if (!user) throw new Error('user was not created');

  return { id: user._id, email: user.email };
}

async function seedReminder(user: Types.ObjectId, title = 'Deadline digest'): Promise<void> {
  await Reminder.create({ user, type: 'custom', title, dueAt: LONG_DUE, channel: 'email' });
}

/** Every digest email sent so far, oldest first. */
function digests() {
  return queuedMail().filter((mail) => mail.kind === 'reminder_digest');
}

async function sweep(now: Date): Promise<void> {
  await runReminderSweep(now);
  await mailQueueIdle();
}

describe('the digest email is sent on each recipient local clock', () => {
  it('mails a Kuala Lumpur account at 00:00 UTC and not at 15:00 UTC', async () => {
    const user = await seedUser(KL);
    await seedReminder(user.id);

    await sweep(LA_DIGEST_UTC_SUMMER);
    expect(digests()).toHaveLength(0);

    await sweep(KL_DIGEST_UTC);
    expect(digests()).toHaveLength(1);
    expect(digests()[0].to).toBe(user.email);
  });

  it('mails a Los Angeles account at 15:00 UTC in summer and not at 00:00 UTC', async () => {
    const user = await seedUser(LA);
    await seedReminder(user.id);

    await sweep(KL_DIGEST_UTC);
    expect(digests()).toHaveLength(0);

    await sweep(LA_DIGEST_UTC_SUMMER);
    expect(digests()).toHaveLength(1);
    expect(digests()[0].to).toBe(user.email);
  });

  it('follows the account across a daylight saving change', async () => {
    const user = await seedUser(LA);
    await seedReminder(user.id);

    // 15:00 UTC is 07:00 local in winter, an hour too early.
    await sweep(new Date('2026-01-10T15:00:00Z'));
    expect(digests()).toHaveLength(0);

    await sweep(LA_DIGEST_UTC_WINTER);
    expect(digests()).toHaveLength(1);
  });

  it('never mails two accounts in distant zones on the same tick', async () => {
    const kl = await seedUser(KL);
    const la = await seedUser(LA);
    await seedReminder(kl.id);
    await seedReminder(la.id);

    await sweep(KL_DIGEST_UTC);
    expect(digests().map((mail) => mail.to)).toEqual([kl.email]);

    await sweep(LA_DIGEST_UTC_SUMMER);
    expect(digests().map((mail) => mail.to)).toEqual([kl.email, la.email]);
  });

  it('is not a shared UTC hour: neither account is mailed at the other hour', async () => {
    const kl = await seedUser(KL);
    const la = await seedUser(LA);
    await seedReminder(kl.id);
    await seedReminder(la.id);

    // The single most important negative. A digest built on one server-wide send
    // time would mail both accounts here; the correct behaviour is one.
    await sweep(KL_DIGEST_UTC);

    const recipients = digests().map((mail) => mail.to);
    expect(recipients).toContain(kl.email);
    expect(recipients).not.toContain(la.email);
  });
});

describe('the digest renders in the recipient timezone', () => {
  it('labels the due time on the reader own clock, not the server one', async () => {
    const kl = await seedUser(KL);
    const la = await seedUser(LA);
    await seedReminder(kl.id, 'Shared instant');
    await seedReminder(la.id, 'Shared instant');

    await sweep(KL_DIGEST_UTC);
    await sweep(LA_DIGEST_UTC_SUMMER);

    const [klMail, laMail] = digests();

    // Both reminders are due at the same UTC instant, 2026-01-01T00:00Z.
    // Kuala Lumpur reads that as 08:00 on 1 Jan; Los Angeles as 16:00 on
    // 31 Dec — a different hour and a different day.
    expect(klMail.text).toContain('1 Jan, 08:00');
    expect(laMail.text).toContain('31 Dec, 16:00');
    expect(klMail.html).toContain('1 Jan, 08:00');
    expect(laMail.html).toContain('31 Dec, 16:00');
  });
});

describe('the digest respects the delivery rules the sweep already had', () => {
  it('sends nothing when the account has turned reminder emails off', async () => {
    const user = await seedUser(KL);
    await seedReminder(user.id);
    await User.updateOne({ _id: user.id }, { $set: { emailRemindersEnabled: false } });

    await sweep(KL_DIGEST_UTC);

    expect(digests()).toHaveLength(0);
  });

  it('sends one digest per recipient, not one email per reminder', async () => {
    const user = await seedUser(KL);
    await seedReminder(user.id, 'First deadline');
    await seedReminder(user.id, 'Second deadline');

    await sweep(KL_DIGEST_UTC);

    expect(digests()).toHaveLength(1);
    expect(digests()[0].text).toContain('First deadline');
    expect(digests()[0].text).toContain('Second deadline');
  });

  it('does not repeat a batch on the next tick', async () => {
    const user = await seedUser(KL);
    await seedReminder(user.id);

    await sweep(KL_DIGEST_UTC);
    await sweep(KL_DIGEST_UTC);

    expect(digests()).toHaveLength(1);
  });
});
