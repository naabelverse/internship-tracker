import { useMemo } from 'react';
import { Badge } from '@/components/ui/Badge';
import { StatusDot } from '@/components/ui/StatusDot';
import { formatDateTime } from '@/lib/formatters';
import {
  INTERVIEW_MODE_LABELS,
  INTERVIEW_OUTCOME_LABELS,
  INTERVIEW_TYPE_LABELS,
  STATUS_CONFIG,
} from '@/lib/statusConfig';
import type { Application, ApplicationStatus } from '@/types/application';

/**
 * A status event's marker is the status itself, so the dot beside "Applied to
 * Ghosted" is the same swatch the board and the legend draw for Ghosted. An
 * interview has no status and keeps a plain marker.
 */
type TimelineEvent = {
  key: string;
  at: string;
  title: string;
  detail?: string;
} & ({ kind: 'status'; status: ApplicationStatus } | { kind: 'interview' });

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
    status: entry.to,
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
          {event.kind === 'status' ? (
            // The marker sits on the rail. A filled dot covers it, but Ghosted
            // is a ring, and the rail would show through the hole - so the
            // wrapper paints the card's own surface under whichever dot it holds.
            <span
              aria-hidden="true"
              className="absolute -left-6 top-1.5 flex h-2.5 w-2.5 rounded-full bg-surface ring-4 ring-canvas"
            >
              <StatusDot status={event.status} size="md" />
            </span>
          ) : (
            <span
              aria-hidden="true"
              className="absolute -left-6 top-1.5 h-2.5 w-2.5 rounded-full bg-primary ring-4 ring-canvas"
            />
          )}

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
