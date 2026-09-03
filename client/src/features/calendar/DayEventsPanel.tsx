import { format } from 'date-fns';
import { EVENT_TONE } from '@/features/calendar/monthModel';
import { INTERVIEW_MODE_LABELS, INTERVIEW_TYPE_LABELS } from '@/lib/statusConfig';
import { formatDateTime } from '@/lib/formatters';
import { cn } from '@/lib/cn';
import type { CalendarEvent } from '@/types/calendar';
import type { InterviewMode, InterviewType } from '@/types/application';

interface DayEventsPanelProps {
  date: Date | null;
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
 * The day list SPEC section 6 asks for. Clicking an event navigates to the Phase 6
 * detail page for its application rather than opening a second summary surface,
 * so there is one place a deadline or interview is edited.
 */
export function DayEventsPanel({
  date,
  events,
  onOpenApplication,
}: DayEventsPanelProps): JSX.Element {
  return (
    <section
      aria-labelledby="day-events-heading"
      className="rounded-card border border-border bg-surface p-4"
    >
      <h2 id="day-events-heading" className="text-sm font-semibold text-content">
        {date === null ? 'Pick a day' : format(date, 'EEEE d MMMM')}
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
                  {describe(event)} · {formatDateTime(event.at)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
