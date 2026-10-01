import { Link } from 'react-router-dom';
import { cn } from '@/lib/cn';
import { daysUntil, formatDateTime, formatRelative } from '@/lib/formatters';
import { EVENT_KIND_CONFIG } from '@/lib/statusConfig';
import type { CalendarEvent } from '@/types/calendar';

/** Matches the board's deadline chip: amber inside three days, red once overdue. */
export function urgencyClass(at: string): string {
  const days = daysUntil(at);

  if (days === null) return 'text-content-subtle';
  if (days < 0) return 'text-danger';

  return days <= 3 ? 'text-warning' : 'text-content-subtle';
}

interface UpcomingRowProps {
  event: Pick<CalendarEvent, 'kind' | 'at' | 'company' | 'role'>;
  /** Where the row leads. The landing hero's example rows have nowhere to go. */
  to?: string;
}

const ROW = 'flex items-center gap-3 py-2.5';

/**
 * The select panel's and date calendar's hover: a wash of the neutral ink.
 * `surface-muted` is a grey for controls, and on the white card it reads as lavender.
 */
const ROW_HOVER = 'rounded-control transition-colors hover:bg-primary/5';

/**
 * One deadline or interview: the dashboard's upcoming panel and the landing
 * hero's example of it both render this, so the picture on the landing page
 * cannot drift from the thing it depicts.
 *
 * The relative date is the headline SPEC section 6 asks for, with the absolute
 * moment kept beside it — "in 3 days" alone is ambiguous once someone has left
 * the tab open overnight.
 */
export function UpcomingRow({ event, to }: UpcomingRowProps): JSX.Element {
  const kind = EVENT_KIND_CONFIG[event.kind];

  const body = (
    <>
      <span
        data-event-dot={event.kind}
        className={cn('h-2 w-2 shrink-0 rounded-full', kind.dot)}
        aria-hidden="true"
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-content">{event.company}</span>
        <span className="block truncate text-xs text-content-subtle">
          {kind.label} — {event.role}
        </span>
      </span>
      <span className="shrink-0 text-right">
        <span className={cn('block text-xs font-medium', urgencyClass(event.at))}>
          {formatRelative(event.at)}
        </span>
        <span className="block text-[0.625rem] text-content-subtle">
          {formatDateTime(event.at)}
        </span>
      </span>
    </>
  );

  return to === undefined ? (
    <div data-upcoming-row="" className={ROW}>
      {body}
    </div>
  ) : (
    <Link data-upcoming-row="" to={to} className={cn(ROW, ROW_HOVER)}>
      {body}
    </Link>
  );
}
