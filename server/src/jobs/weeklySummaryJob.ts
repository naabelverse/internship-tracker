import cron, { type ScheduledTask } from 'node-cron';
import { env } from '@/config/env';
import { logger } from '@/config/logger';
import { isDigestHourIn } from '@/jobs/reminderJob';
import { User, type UserDocument } from '@/models/User';
import { mailRecipientFor, sendMail } from '@/services/mailer.service';
import { buildWeeklySummary } from '@/services/weeklySummary.service';
import { localWeekday } from '@/utils/dates';

/**
 * The opt-in weekly summary.
 *
 * Same infrastructure as Phase 4's reminder sweep, not a second scheduling
 * mechanism: the same hourly UTC expression, registered by the same
 * `startScheduledJobs`, resolving the recipient's hour through the very function
 * the reminder sweep uses. The only thing added is a weekday predicate.
 *
 * It is a separate task rather than a branch inside the reminder sweep because
 * the two select on different things — that sweep is driven by `Reminder`
 * documents coming due and gated on `emailRemindersEnabled`, this one by the
 * calendar and gated on `weeklySummaryEnabled`. One function doing both
 * selections against two preferences is how a preference bug gets written.
 */
export const WEEKLY_SUMMARY_CRON_EXPRESSION = '0 * * * *';

/**
 * A summary is not re-sent inside this window.
 *
 * A local weekday plus a local hour already picks out one tick a week, so this
 * only ever matters when the process restarts inside that hour — which is
 * exactly when a redeploy would otherwise mail everyone in that zone twice. Six
 * days rather than seven leaves room for the hour to move across a daylight
 * saving change without skipping a week.
 */
export const WEEKLY_SUMMARY_MIN_GAP_MS = 6 * 24 * 60 * 60 * 1000;

function isSummaryWeekdayIn(timeZone: string, now: Date): boolean {
  try {
    return localWeekday(now, timeZone) === env.WEEKLY_SUMMARY_WEEKDAY;
  } catch {
    // `isDigestHourIn` has already reported this same zone, so skipping quietly
    // here avoids two warnings a tick for one unusable row.
    return false;
  }
}

/** The zones whose wall clock currently reads the summary weekday and hour. */
export async function selectWeeklySummaryZones(now: Date): Promise<string[]> {
  const zones = (await User.distinct('timezone', {
    deletedAt: null,
    weeklySummaryEnabled: true,
  })) as string[];

  return zones.filter((zone) => isDigestHourIn(zone, now) && isSummaryWeekdayIn(zone, now));
}

/**
 * Accounts due a summary on this tick: opted in, live, in a zone whose clock
 * reads the send time, and not already sent one this week.
 */
export async function selectWeeklySummaryRecipients(now: Date): Promise<UserDocument[]> {
  const zones = await selectWeeklySummaryZones(now);

  if (zones.length === 0) return [];

  return User.find({
    timezone: { $in: zones },
    deletedAt: null,
    weeklySummaryEnabled: true,
    $or: [
      { lastWeeklySummaryAt: { $exists: false } },
      { lastWeeklySummaryAt: null },
      { lastWeeklySummaryAt: { $lte: new Date(now.getTime() - WEEKLY_SUMMARY_MIN_GAP_MS) } },
    ],
  });
}

/**
 * Builds and queues one summary per due account, and returns how many went out.
 *
 * The stamp is written before the sends are queued, for the same reason the
 * reminder sweep claims its batch first: a duplicated weekly email is a worse
 * outcome than a missed one, and the retry queue already covers a transport that
 * is briefly down.
 */
export async function runWeeklySummarySweep(now: Date = new Date()): Promise<number> {
  const recipients = await selectWeeklySummaryRecipients(now);

  if (recipients.length === 0) return 0;

  await User.updateMany(
    { _id: { $in: recipients.map((user) => user._id) } },
    { $set: { lastWeeklySummaryAt: now } },
  );

  for (const user of recipients) {
    const data = await buildWeeklySummary(user, now);

    sendMail({
      to: user.email,
      recipient: mailRecipientFor(user),
      message: { kind: 'weekly_summary', data },
    });
  }

  logger.info('Weekly summary batch sent', {
    count: recipients.length,
    at: now.toISOString(),
    weekday: env.WEEKLY_SUMMARY_WEEKDAY,
    hour: env.REMINDER_DIGEST_HOUR,
  });

  return recipients.length;
}

export function startWeeklySummaryCron(): ScheduledTask {
  return cron.schedule(
    WEEKLY_SUMMARY_CRON_EXPRESSION,
    () => {
      void runWeeklySummarySweep().catch((error: unknown) => {
        logger.error('Weekly summary sweep failed', {
          message: error instanceof Error ? error.message : String(error),
        });
      });
    },
    { timezone: 'UTC' },
  );
}
