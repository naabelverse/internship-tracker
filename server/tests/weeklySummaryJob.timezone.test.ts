import type { Types } from 'mongoose';
import {
  runWeeklySummarySweep,
  selectWeeklySummaryRecipients,
  selectWeeklySummaryZones,
} from '@/jobs/weeklySummaryJob';
import { User } from '@/models/User';
import { clearMailQueue, mailQueueIdle, queuedMail, resetMailer } from '@/services/mailer.service';
import { buildTestApp, registerUser, useCleanAuthRateLimits } from './helpers/factories';
import { useTestDatabase } from './helpers/testDb';

/**
 * The weekly summary is scheduled on the same terms as the reminder digest: the
 * recipient's own local hour, resolved through the same `isDigestHourIn` the
 * Phase 4 sweep uses, plus a local weekday.
 *
 * Same two-zone fixture as `reminderJob.timezone.test.ts` and
 * `mail.digestTimezone.test.ts`, for the same reason — this is a second job, and
 * a second job is exactly where a shared UTC send time gets reintroduced.
 */

useTestDatabase();
useCleanAuthRateLimits();

const app = buildTestApp();

const KL = 'Asia/Kuala_Lumpur';
const LA = 'America/Los_Angeles';

// The summary goes out on Monday (WEEKLY_SUMMARY_WEEKDAY=1) at 08:00 local
// (REMINDER_DIGEST_HOUR=8).
// Monday 9 March 2026, 08:00 local, is 00:00 UTC in Kuala Lumpur (UTC+8) and
// 15:00 UTC in Los Angeles, which is on daylight time by then (UTC-7).
const KL_SUMMARY_UTC = new Date('2026-03-09T00:00:00Z');
const LA_SUMMARY_UTC_SUMMER = new Date('2026-03-09T15:00:00Z');
// In January, Los Angeles is on standard time, so the same local hour is 16:00.
const LA_SUMMARY_UTC_WINTER = new Date('2026-01-12T16:00:00Z');
// The right hour, the wrong day: Tuesday.
const KL_TUESDAY_UTC = new Date('2026-03-10T00:00:00Z');

beforeEach(() => {
  resetMailer();
  clearMailQueue();
});

async function seedSubscriber(
  timeZone: string,
  weeklySummaryEnabled = true,
): Promise<{ id: Types.ObjectId; email: string }> {
  const registered = await registerUser(app, { timezone: timeZone });
  const user = await User.findById(registered.userId);
  if (!user) throw new Error('user was not created');

  await User.updateOne({ _id: user._id }, { $set: { weeklySummaryEnabled } });

  return { id: user._id, email: user.email };
}

function summaries() {
  return queuedMail().filter((mail) => mail.kind === 'weekly_summary');
}

async function sweep(now: Date): Promise<void> {
  await runWeeklySummarySweep(now);
  await mailQueueIdle();
}

describe('the weekly summary is sent on each recipient local clock', () => {
  it('mails a Kuala Lumpur account at 00:00 UTC on Monday and not at 15:00 UTC', async () => {
    const user = await seedSubscriber(KL);

    await sweep(LA_SUMMARY_UTC_SUMMER);
    expect(summaries()).toHaveLength(0);

    await sweep(KL_SUMMARY_UTC);
    expect(summaries()).toHaveLength(1);
    expect(summaries()[0].to).toBe(user.email);
  });

  it('mails a Los Angeles account at 15:00 UTC in summer and not at 00:00 UTC', async () => {
    const user = await seedSubscriber(LA);

    await sweep(KL_SUMMARY_UTC);
    expect(summaries()).toHaveLength(0);

    await sweep(LA_SUMMARY_UTC_SUMMER);
    expect(summaries()).toHaveLength(1);
    expect(summaries()[0].to).toBe(user.email);
  });

  it('follows the account across a daylight saving change', async () => {
    await seedSubscriber(LA);

    // 15:00 UTC is 07:00 local in winter, an hour too early.
    await sweep(new Date('2026-01-12T15:00:00Z'));
    expect(summaries()).toHaveLength(0);

    await sweep(LA_SUMMARY_UTC_WINTER);
    expect(summaries()).toHaveLength(1);
  });

  it('is not a shared UTC hour: only one of two distant accounts is mailed per tick', async () => {
    const kl = await seedSubscriber(KL);
    const la = await seedSubscriber(LA);

    await sweep(KL_SUMMARY_UTC);

    const recipients = summaries().map((mail) => mail.to);
    expect(recipients).toContain(kl.email);
    expect(recipients).not.toContain(la.email);

    await sweep(LA_SUMMARY_UTC_SUMMER);
    expect(summaries().map((mail) => mail.to)).toEqual([kl.email, la.email]);
  });

  it('reports only the zones whose clock currently reads the summary hour', async () => {
    await seedSubscriber(KL);
    await seedSubscriber(LA);

    expect(await selectWeeklySummaryZones(KL_SUMMARY_UTC)).toEqual([KL]);
    expect(await selectWeeklySummaryZones(LA_SUMMARY_UTC_SUMMER)).toEqual([LA]);
    expect(await selectWeeklySummaryZones(new Date('2026-03-09T03:00:00Z'))).toEqual([]);
  });
});

describe('the weekly summary respects the weekday as well as the hour', () => {
  it('sends nothing on a Tuesday at the same local hour', async () => {
    await seedSubscriber(KL);

    await sweep(KL_TUESDAY_UTC);

    expect(summaries()).toHaveLength(0);
  });

  it('sends nothing on a Monday at the wrong local hour', async () => {
    await seedSubscriber(KL);

    // 09:00 UTC is 17:00 in Kuala Lumpur.
    await sweep(new Date('2026-03-09T09:00:00Z'));

    expect(summaries()).toHaveLength(0);
  });
});

describe('opting in is what selects an account', () => {
  it('skips an account that has not opted in', async () => {
    await seedSubscriber(KL, false);

    await sweep(KL_SUMMARY_UTC);

    expect(summaries()).toHaveLength(0);
    expect(await selectWeeklySummaryRecipients(KL_SUMMARY_UTC)).toHaveLength(0);
  });

  it('skips a closed account', async () => {
    const user = await seedSubscriber(KL);
    await User.updateOne({ _id: user.id }, { $set: { deletedAt: new Date() } });

    await sweep(KL_SUMMARY_UTC);

    expect(summaries()).toHaveLength(0);
  });
});

describe('a summary is not sent twice in one week', () => {
  it('does not resend when the sweep runs again in the same hour', async () => {
    await seedSubscriber(KL);

    await sweep(KL_SUMMARY_UTC);
    await sweep(KL_SUMMARY_UTC);

    expect(summaries()).toHaveLength(1);
  });

  it('sends again the following week', async () => {
    await seedSubscriber(KL);

    await sweep(KL_SUMMARY_UTC);
    await sweep(new Date('2026-03-16T00:00:00Z'));

    expect(summaries()).toHaveLength(2);
  });

  it('stamps when the summary was last sent', async () => {
    const user = await seedSubscriber(KL);

    await sweep(KL_SUMMARY_UTC);

    const stored = await User.findById(user.id);
    expect(stored?.lastWeeklySummaryAt).toEqual(KL_SUMMARY_UTC);
  });
});

describe('the summary reports the week that just ended, in local terms', () => {
  it('labels the previous local week rather than the week it is sent in', async () => {
    await seedSubscriber(KL);

    await sweep(KL_SUMMARY_UTC);

    // Sent Monday 9 March; the reported week is Monday 2 March to Sunday 8.
    expect(summaries()[0].text).toContain('2 Mar');
    expect(summaries()[0].text).toContain('8 Mar');
  });

  it('carries the stats block in both bodies', async () => {
    await seedSubscriber(KL);

    await sweep(KL_SUMMARY_UTC);

    for (const body of [summaries()[0].text, summaries()[0].html]) {
      expect(body).toContain('Applied');
      expect(body).toContain('Interviews');
      expect(body).toContain('Streak');
    }
  });
});
