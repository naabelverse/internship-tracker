import cron, { type ScheduledTask } from 'node-cron';
import { env } from '@/config/env';
import { logger } from '@/config/logger';
import type { DigestItem } from '@/mail/types';
import { Application } from '@/models/Application';
import { Reminder, type ReminderDocument } from '@/models/Reminder';
import { User } from '@/models/User';
import { mailRecipientFor, sendMail } from '@/services/mailer.service';
import { localDateTimeLabel, localHour } from '@/utils/dates';

/** Hourly, on the hour, in UTC. The per-user local hour is resolved inside the sweep. */
export const REMINDER_CRON_EXPRESSION = '0 * * * *';

/**
 * Whether this zone's wall clock currently reads the digest hour.
 *
 * Exported because the weekly summary job asks exactly the same question.
 * Sharing the function rather than the idea is deliberate: this is the one place
 * daylight saving is handled correctly, and a second copy would be a second
 * chance to get it wrong.
 */
export function isDigestHourIn(timeZone: string, now: Date): boolean {
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
 * The company and role behind each reminder, so a digest line reads as more than
 * a bare title. One query for the whole batch rather than a populate per row.
 */
async function contextByApplication(due: ReminderDocument[]): Promise<Map<string, string>> {
  const ids = due
    .map((reminder) => reminder.application)
    .filter((id): id is NonNullable<typeof id> => id !== undefined && id !== null);

  if (ids.length === 0) return new Map();

  const applications = await Application.find({ _id: { $in: ids } }).select('company role');

  return new Map(
    applications.map((application) => [
      application._id.toString(),
      `${application.company} — ${application.role}`,
    ]),
  );
}

/**
 * Turns the claimed batch into one digest per recipient.
 *
 * Every `dueAt` is rendered against that user's own timezone here, which is the
 * same zone the batch was selected by. The template never sees an instant, so
 * the digest cannot drift back onto a server clock.
 */
async function deliverDigests(due: ReminderDocument[]): Promise<void> {
  const recipients = await User.find({
    _id: { $in: [...new Set(due.map((reminder) => reminder.user.toString()))] },
    deletedAt: null,
  });

  const context = await contextByApplication(due);

  for (const user of recipients) {
    const items: DigestItem[] = due
      .filter((reminder) => reminder.user.toString() === user._id.toString())
      .map((reminder) => ({
        title: reminder.title,
        dueLabel: localDateTimeLabel(reminder.dueAt, user.timezone),
        context: reminder.application ? context.get(reminder.application.toString()) : undefined,
      }));

    if (items.length === 0) continue;

    sendMail({
      to: user.email,
      recipient: mailRecipientFor(user),
      message: { kind: 'reminder_digest', data: { name: user.name, items } },
    });
  }
}

/**
 * Selects the current batch, claims it, and mails it.
 *
 * The batch is marked sent before delivery is attempted, which makes this
 * at-most-once on purpose: the retry queue already gives a transient failure
 * three attempts, and a reminder delivered twice is worse than one missed. The
 * claim is also what stops the next hourly tick re-sending the same batch.
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

  await deliverDigests(due);

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
