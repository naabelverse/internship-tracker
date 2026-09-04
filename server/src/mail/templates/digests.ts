import { boardUrl, dashboardUrl } from '@/mail/links';
import type { ListEntry, MailBlock } from '@/mail/layout';
import type { TemplateOutput } from '@/mail/templates/security';
import type { DigestItem, ReminderDigestData, WeeklySummaryData } from '@/mail/types';

/**
 * The two non-transactional templates. Both are gated on a preference and both
 * carry an unsubscribe link, which the registry adds to the shared footer.
 *
 * Neither template knows anything about time zones. Every instant has already
 * been rendered to a label in the recipient's own zone by the job that built the
 * payload, so there is no second place for a UTC assumption to creep back in.
 */

function toListEntry(item: DigestItem): ListEntry {
  return { title: item.title, detail: item.dueLabel, context: item.context };
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

export function reminderDigestTemplate(data: ReminderDigestData): TemplateOutput {
  const count = data.items.length;
  const noun = plural(count, 'reminder', 'reminders');

  return {
    subject: `${String(count)} ${noun} for today`,
    heading: 'Coming up',
    preheader: `${String(count)} ${plural(count, 'deadline or interview', 'deadlines and interviews')} need you.`,
    blocks: [
      { type: 'paragraph', text: `Hi ${data.name},` },
      {
        type: 'paragraph',
        text: `You have ${String(count)} ${noun} due. Here they are, oldest first.`,
      },
      { type: 'list', entries: data.items.map(toListEntry) },
      { type: 'button', label: 'Open my board', url: boardUrl() },
    ],
  };
}

function statsBlock(data: WeeklySummaryData): MailBlock {
  const { stats } = data;

  return {
    type: 'stats',
    items: [
      { label: 'Added', value: String(stats.created), hint: 'new applications' },
      { label: 'Applied', value: String(stats.applied), hint: 'sent off' },
      { label: 'Replies', value: String(stats.responded), hint: `${String(stats.responseRate)}%` },
      { label: 'Interviews', value: String(stats.interviewed) },
      { label: 'Offers', value: String(stats.offers) },
      {
        label: 'Streak',
        value: String(stats.currentStreakDays),
        hint: plural(stats.currentStreakDays, 'day', 'days'),
      },
    ],
  };
}

function goalBlock(data: WeeklySummaryData): MailBlock {
  const { weeklyGoalCompleted: done, weeklyGoalTarget: target } = data.stats;

  if (target === 0) {
    return {
      type: 'note',
      text: 'You have no weekly goal set. Setting one in Settings turns this summary into something to aim at.',
    };
  }

  const text =
    done >= target
      ? `You hit your weekly goal: ${String(done)} of ${String(target)} applications. That is the hard part done.`
      : `You are ${String(target - done)} short of your weekly goal of ${String(target)}, with ${String(done)} logged.`;

  return { type: 'note', text };
}

export function weeklySummaryTemplate(data: WeeklySummaryData): TemplateOutput {
  const blocks: MailBlock[] = [
    { type: 'paragraph', text: `Hi ${data.name},` },
    { type: 'paragraph', text: `Here is how ${data.weekLabel} went.` },
    statsBlock(data),
    goalBlock(data),
  ];

  if (data.upcoming.length > 0) {
    blocks.push(
      { type: 'paragraph', text: 'Due next:' },
      { type: 'list', entries: data.upcoming.map(toListEntry) },
    );
  }

  blocks.push({ type: 'button', label: 'Open my dashboard', url: dashboardUrl() });

  return {
    subject: `Your week: ${data.weekLabel}`,
    heading: `Your week: ${data.weekLabel}`,
    preheader: `${String(data.stats.applied)} applied, ${String(data.stats.responded)} replies, ${String(data.stats.interviewed)} interviews.`,
    blocks,
  };
}
