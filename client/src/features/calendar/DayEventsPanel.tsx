import { format } from 'date-fns';
import {
  EVENT_KIND_CONFIG,
  INTERVIEW_MODE_LABELS,
  INTERVIEW_TYPE_LABELS,
} from '@/lib/statusConfig';
import { formatDate, formatDateIn, formatTimeIn, isDateOnly } from '@/lib/formatters';
import { cn } from '@/lib/cn';
import type { CalendarEvent } from '@/types/calendar';
import type { InterviewMode, InterviewType } from '@/types/application';
import { Card } from '@/components/ui/Card';

interface DayEventsPanelProps {
  date: Date | null;
  /** The month the grid shows, which can differ from `date`'s for a borrowed cell. */
  month: Date;
  events: CalendarEvent[];
  /** The account's IANA zone, which the grid grouped the events in. */
  timeZone: string;
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
 * Both are read in the account's zone, the one the grid placed the event by.
 */
function EventTime({ event, timeZone }: { event: CalendarEvent; timeZone: string }): JSX.Element {
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
        <span className="sr-only">{formatDateIn(event.at, timeZone)}, </span>
        {formatTimeIn(event.at, timeZone)}
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
  timeZone,
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
              {/*
               * These cards sit on the panel's own surface with no fill step, so
               * the border alone draws them: `border-strong` (2.15:1 light, 1.72:1
               * dark against the panel) rather than the app-wide `border` (1.30,
               * 1.27). The dot is the Upcoming panel's solid one; the grid's chip
               * tint paints only its 15% fill on a dot, about 1.3:1.
               */}
              <button
                type="button"
                onClick={() => {
                  onOpenApplication(event.applicationId);
                }}
                className="w-full rounded-control border border-border-strong px-3 py-2 text-left transition-colors hover:bg-surface-muted"
              >
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    data-event-dot={event.kind}
                    className={cn('h-2 w-2 rounded-full', EVENT_KIND_CONFIG[event.kind].dot)}
                  />
                  <span className="truncate text-sm font-medium text-content">{event.company}</span>
                </span>
                <span className="mt-0.5 block truncate text-xs text-content-muted">
                  {event.role}
                </span>
                <span className="mt-0.5 block text-xs text-content-subtle">
                  {describe(event)}
                  <EventTime event={event} timeZone={timeZone} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
