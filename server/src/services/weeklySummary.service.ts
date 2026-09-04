import type { DigestItem, WeeklySummaryData } from '@/mail/types';
import { Application } from '@/models/Application';
import { Reminder } from '@/models/Reminder';
import type { UserDocument } from '@/models/User';
import { getSummary } from '@/services/analytics.service';
import { localDateLabel, localDateTimeLabel, startOfLocalWeek } from '@/utils/dates';

/**
 * Builds the weekly summary payload for one user.
 *
 * The numbers come from Phase 8's `getSummary` — the same pipeline the dashboard
 * reads — rather than from a second set of aggregations written for email. A
 * summary that disagreed with the dashboard would be worse than no summary.
 */

/** How many upcoming items the summary lists before it stops being a summary. */
const UPCOMING_LIMIT = 5;
const UPCOMING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The last instant of the week being reported.
 *
 * The summary goes out on a Monday morning and is about the week that just
 * ended, so the window has to close at that boundary rather than at "now".
 * Taking one millisecond before this local week began puts every derived figure
 * — the seven day period, the weekly goal window, the streak — inside the
 * reported week without any of them needing a special case.
 */
export function reportedWeekEnd(now: Date, timeZone: string): Date {
  return new Date(startOfLocalWeek(now, timeZone).getTime() - 1);
}

async function upcomingFor(user: UserDocument, from: Date): Promise<DigestItem[]> {
  const reminders = await Reminder.find({
    user: user._id,
    readAt: null,
    dueAt: { $gte: from, $lte: new Date(from.getTime() + UPCOMING_WINDOW_MS) },
  })
    .sort({ dueAt: 1 })
    .limit(UPCOMING_LIMIT);

  const applicationIds = reminders
    .map((reminder) => reminder.application)
    .filter((id): id is NonNullable<typeof id> => id !== undefined && id !== null);

  const applications =
    applicationIds.length > 0
      ? await Application.find({ _id: { $in: applicationIds } }).select('company role')
      : [];

  const context = new Map(
    applications.map((application) => [
      application._id.toString(),
      `${application.company} — ${application.role}`,
    ]),
  );

  return reminders.map((reminder) => ({
    title: reminder.title,
    dueLabel: localDateTimeLabel(reminder.dueAt, user.timezone),
    context: reminder.application ? context.get(reminder.application.toString()) : undefined,
  }));
}

export async function buildWeeklySummary(
  user: UserDocument,
  now: Date = new Date(),
): Promise<WeeklySummaryData> {
  const weekEnd = reportedWeekEnd(now, user.timezone);
  const weekStart = startOfLocalWeek(weekEnd, user.timezone);
  const summary = await getSummary(user._id, user.timezone, user.weeklyGoal, weekEnd, 7);
  const upcoming = await upcomingFor(user, now);

  return {
    name: user.name,
    weekLabel: `${localDateLabel(weekStart, user.timezone)} – ${localDateLabel(weekEnd, user.timezone)}`,
    stats: {
      created: summary.period.current.created,
      applied: summary.period.current.applied,
      responded: summary.period.current.responded,
      interviewed: summary.period.current.interviewed,
      offers: summary.period.current.offers,
      responseRate: summary.period.current.responseRate,
      currentStreakDays: summary.currentStreakDays,
      weeklyGoalTarget: summary.weeklyGoal.target,
      weeklyGoalCompleted: summary.weeklyGoal.completed,
    },
    upcoming,
  };
}
