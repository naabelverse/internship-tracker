import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/Card';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { CalendarIcon } from '@/components/ui/icons';
import { cn } from '@/lib/cn';
import { daysUntil, formatDateTime, formatRelative } from '@/lib/formatters';
import { EVENT_KIND_CONFIG } from '@/lib/statusConfig';
import { paths } from '@/routes/paths';
import type { CalendarEvent } from '@/types/calendar';

interface UpcomingPanelProps {
  events: CalendarEvent[] | undefined;
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
}

const UPCOMING_LIMIT = 5;

/** Matches the board's deadline chip: amber inside three days, red once overdue. */
function urgencyClass(at: string): string {
  const days = daysUntil(at);

  if (days === null) return 'text-content-subtle';
  if (days < 0) return 'text-danger';

  return days <= 3 ? 'text-warning' : 'text-content-subtle';
}

/**
 * The next five deadlines and interviews, from the merged calendar stream.
 *
 * The relative date is the headline SPEC section 6 asks for, with the absolute
 * moment kept beside it — "in 3 days" alone is ambiguous once someone has left
 * the tab open overnight.
 */
export function UpcomingPanel({
  events,
  isLoading,
  error,
  onRetry,
}: UpcomingPanelProps): JSX.Element {
  const upcoming = (events ?? [])
    .slice()
    .sort((a, b) => a.at.localeCompare(b.at))
    .slice(0, UPCOMING_LIMIT);

  return (
    <Card as="section">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="panel-title">Upcoming</h2>
        <Link to={paths.calendar} className="text-xs font-medium text-primary hover:underline">
          Open calendar
        </Link>
      </div>

      {isLoading ? (
        <div className="mt-4 space-y-2">
          {[0, 1, 2, 3, 4].map((row) => (
            <Skeleton
              key={row}
              className="h-12 w-full"
              label={row === 0 ? 'Loading upcoming' : undefined}
            />
          ))}
        </div>
      ) : error !== null ? (
        <div className="mt-4">
          <ErrorState error={error} fallback="Upcoming events could not load." onRetry={onRetry} />
        </div>
      ) : upcoming.length === 0 ? (
        <p className="mt-6 flex flex-col items-center gap-2 text-center text-sm text-content-muted">
          <CalendarIcon className="h-6 w-6 text-content-subtle" aria-hidden="true" />
          Nothing scheduled in the next few weeks.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-border">
          {upcoming.map((event) => (
            <li key={event.id}>
              <Link
                to={paths.applicationDetail(event.applicationId)}
                className="flex items-center gap-3 rounded-control py-2.5 transition-colors hover:bg-surface-muted"
              >
                <span
                  data-event-dot={event.kind}
                  className={cn('h-2 w-2 shrink-0 rounded-full', EVENT_KIND_CONFIG[event.kind].dot)}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-content">
                    {event.company}
                  </span>
                  <span className="block truncate text-xs text-content-subtle">
                    {EVENT_KIND_CONFIG[event.kind].label} — {event.role}
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
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
