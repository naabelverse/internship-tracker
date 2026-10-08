import { format } from 'date-fns';
import { EVENT_TONE } from '@/features/calendar/monthModel';
import { INTERVIEW_MODE_LABELS, INTERVIEW_TYPE_LABELS } from '@/lib/statusConfig';
import { formatDate, formatTime, isDateOnly } from '@/lib/formatters';
import { cn } from '@/lib/cn';
import type { CalendarEvent } from '@/types/calendar';
import type { InterviewMode, InterviewType } from '@/types/application';
import { Card } from '@/components/ui/Card';

interface DayEventsPanelProps {
  date: Date | null;
  /** The month the grid shows, which can differ from `date`'s for a borrowed cell. */
  month: Date;
  events: CalendarEvent[];
  onOpenApplication: (applicationId: string) => void;
}

function describe(event: CalendarEvent): string {
  if (event.kind === 'deadline') return 'Application deadline';

  const type = event.interviewType
    ? INTERVIEW_TYPE_LABELS[event.interviewType as InterviewType]
    : 'Interview';
  const mode = event.mode ? INTERVIEW_MODE_LABELS[event.mode as InterviewMode] : undefined;

  return mode ? `${type} · ${mode}` : type;
}

/**
 * "Sunday 5 July", with the year only when the day is outside this year or
 * outside the shown month's year (a December cell borrowed by January), since
 * the cards below carry no year of their own.
 */
function heading(date: Date, month: Date, now = new Date()): string {
  const year = date.getFullYear();
  const showYear = year !== now.getFullYear() || year !== month.getFullYear();
  return format(date, showYear ? 'EEEE d MMMM yyyy' : 'EEEE d MMMM');
}

/**
 * The time alone, since the heading names the day. The date stays in the
 * accessible name as screen-reader text, and a date-only deadline shows no time.
 */
function EventTime({ event }: { event: CalendarEvent }): JSX.Element {
  if (event.kind === 'deadline' && isDateOnly(event.at)) {
    return (
      <time dateTime={event.at}>
        <span className="sr-only">, {formatDate(event.at)}</span>
      </time>
    );
  }

  return (
    <>
      {' · '}
      <time dateTime={event.at}>
        <span className="sr-only">{formatDate(event.at)}, </span>
        {formatTime(event.at)}
      </time>
    </>
  );
}

/**
 * The day list SPEC section 6 asks for. Clicking an event navigates to the Phase 6
 * detail page for its application rather than opening a second summary surface,
 * so there is one place a deadline or interview is edited.
 */
export function DayEventsPanel({
  date,
  month,
  events,
  onOpenApplication,
}: DayEventsPanelProps): JSX.Element {
  return (
    <Card as="section" aria-labelledby="day-events-heading">
      <h2 id="day-events-heading" className="panel-title">
        {date === null ? 'Pick a day' : heading(date, month)}
      </h2>

      {date === null && (
        <p className="mt-2 text-sm text-content-muted">
          Choose a day in the grid to see its deadlines and interviews.
        </p>
      )}

      {date !== null && events.length === 0 && (
        <p className="mt-2 text-sm text-content-muted">Nothing scheduled for this day.</p>
      )}

      {events.length > 0 && (
        <ul className="mt-3 space-y-2">
          {events.map((event) => (
            <li key={event.id}>
              <button
                type="button"
                onClick={() => {
                  onOpenApplication(event.applicationId);
                }}
                className="w-full rounded-control border border-border px-3 py-2 text-left transition-colors hover:bg-surface-muted"
              >
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className={cn('h-2 w-2 rounded-full', EVENT_TONE[event.kind])}
                  />
                  <span className="truncate text-sm font-medium text-content">{event.company}</span>
                </span>
                <span className="mt-0.5 block truncate text-xs text-content-muted">
                  {event.role}
                </span>
                <span className="mt-0.5 block text-xs text-content-subtle">
                  {describe(event)}
                  <EventTime event={event} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
