import { useMemo } from 'react';
import { Badge } from '@/components/ui/Badge';
import { formatDateTime } from '@/lib/formatters';
import {
  INTERVIEW_MODE_LABELS,
  INTERVIEW_OUTCOME_LABELS,
  INTERVIEW_TYPE_LABELS,
  STATUS_CONFIG,
} from '@/lib/statusConfig';
import { cn } from '@/lib/cn';
import type { Application } from '@/types/application';

interface TimelineEvent {
  key: string;
  at: string;
  kind: 'status' | 'interview';
  title: string;
  detail?: string;
  dot: string;
}

/**
 * Merges `statusHistory` and `interviews` into one chronological list, newest
 * first. They are two different shapes on the document but one story to the user,
 * so they are normalised here rather than rendered as two stacked lists.
 */
function buildEvents(application: Application): TimelineEvent[] {
  const statusEvents: TimelineEvent[] = application.statusHistory.map((entry, index) => ({
    key: `status-${String(index)}-${entry.changedAt}`,
    at: entry.changedAt,
    kind: 'status',
    title: entry.from
      ? `${STATUS_CONFIG[entry.from].label} to ${STATUS_CONFIG[entry.to].label}`
      : `Added as ${STATUS_CONFIG[entry.to].label}`,
    detail: entry.note,
    dot: STATUS_CONFIG[entry.to].dot,
  }));

  const interviewEvents: TimelineEvent[] = application.interviews.map((interview) => ({
    key: `interview-${interview.id}`,
    at: interview.scheduledAt,
    kind: 'interview',
    title: `${INTERVIEW_TYPE_LABELS[interview.type]} interview`,
    detail: [
      INTERVIEW_MODE_LABELS[interview.mode],
      interview.interviewer,
      interview.round === undefined ? undefined : `Round ${String(interview.round)}`,
      INTERVIEW_OUTCOME_LABELS[interview.outcome],
    ]
      .filter(Boolean)
      .join(' · '),
    dot: 'bg-primary',
  }));

  return [...statusEvents, ...interviewEvents].sort(
    (left, right) => new Date(right.at).getTime() - new Date(left.at).getTime(),
  );
}

export function ApplicationTimeline({ application }: { application: Application }): JSX.Element {
  const events = useMemo(() => buildEvents(application), [application]);

  if (events.length === 0) {
    return (
      <p className="text-sm text-content-muted">
        Nothing has happened yet. Status changes and interviews will appear here.
      </p>
    );
  }

  return (
    <ol data-testid="application-timeline" className="relative space-y-5 pl-6">
      <span
        aria-hidden="true"
        className="absolute bottom-2 left-[0.3125rem] top-2 w-px bg-border"
      />

      {events.map((event) => (
        <li key={event.key} className="relative">
          <span
            aria-hidden="true"
            className={cn(
              'absolute -left-6 top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-canvas',
              event.dot,
            )}
          />

          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <p className="text-sm font-medium text-content">{event.title}</p>
            {event.kind === 'interview' && (
              <Badge className="bg-primary/15 text-primary">Interview</Badge>
            )}
          </div>

          <p className="text-xs text-content-subtle">{formatDateTime(event.at)}</p>
          {event.detail && <p className="mt-1 text-sm text-content-muted">{event.detail}</p>}
        </li>
      ))}
    </ol>
  );
}
