import cron, { type ScheduledTask } from 'node-cron';
import { env } from '@/config/env';
import { logger } from '@/config/logger';
import { Reminder, type ReminderDocument } from '@/models/Reminder';
import { User } from '@/models/User';
import { localHour } from '@/utils/dates';

/** Hourly, on the hour, in UTC. The per-user local hour is resolved inside the sweep. */
export const REMINDER_CRON_EXPRESSION = '0 * * * *';

function isDigestHourIn(timeZone: string, now: Date): boolean {
  try {
    return localHour(now, timeZone) === env.REMINDER_DIGEST_HOUR;
  } catch {
    // A stored zone that the runtime cannot resolve must not stall the sweep for
    // everyone else, so it is skipped and reported.
    logger.warn('Skipping unresolvable timezone during reminder sweep', { timeZone });
    return false;
  }
}

/**
 * The zones whose wall clock currently reads the digest hour.
 *
 * Resolved through Intl rather than a stored UTC offset, because the offset for
 * a zone changes across daylight saving. Asia/Kuala_Lumpur reads 08:00 at 00:00
 * UTC all year; America/Los_Angeles reads 08:00 at 15:00 UTC in summer and
 * 16:00 UTC in winter.
 */
export async function selectTimeZonesAtDigestHour(now: Date): Promise<string[]> {
  const zones = (await User.distinct('timezone', {
    deletedAt: null,
    emailRemindersEnabled: true,
  })) as string[];

  return zones.filter((zone) => isDigestHourIn(zone, now));
}

/**
 * Reminders that are both due in absolute terms and allowed to be delivered in
 * this UTC hour for their owner. `dueAt` is a UTC instant so due-ness is
 * timezone independent; the delivery window is not, which is the whole point.
 */
export async function selectDueReminders(now: Date): Promise<ReminderDocument[]> {
  const zones = await selectTimeZonesAtDigestHour(now);

  if (zones.length === 0) return [];

  const recipients = await User.find({
    timezone: { $in: zones },
    deletedAt: null,
    emailRemindersEnabled: true,
  }).select('_id');

  if (recipients.length === 0) return [];

  return Reminder.find({
    user: { $in: recipients.map((recipient) => recipient._id) },
    channel: 'email',
    sent: false,
    dueAt: { $lte: now },
  }).sort({ dueAt: 1 });
}

/**
 * Selects and claims the current batch. Delivery itself is Phase 12: this marks
 * the batch as sent and records it, and the mail queue replaces the log sink
 * once a transport exists.
 */
export async function runReminderSweep(now: Date = new Date()): Promise<ReminderDocument[]> {
  const due = await selectDueReminders(now);

  if (due.length === 0) return [];

  await Reminder.updateMany(
    { _id: { $in: due.map((reminder) => reminder._id) } },
    { $set: { sent: true, sentAt: now } },
  );

  logger.info('Reminder digest batch selected', {
    count: due.length,
    at: now.toISOString(),
    digestHour: env.REMINDER_DIGEST_HOUR,
  });

  return due;
}

export function startReminderCron(): ScheduledTask {
  return cron.schedule(
    REMINDER_CRON_EXPRESSION,
    () => {
      void runReminderSweep().catch((error: unknown) => {
        logger.error('Reminder sweep failed', {
          message: error instanceof Error ? error.message : String(error),
        });
      });
    },
    { timezone: 'UTC' },
  );
}
