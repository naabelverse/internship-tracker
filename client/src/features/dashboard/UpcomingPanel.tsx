import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/Card';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { CalendarIcon } from '@/components/ui/icons';
import { UpcomingRow } from '@/features/dashboard/UpcomingRow';
import { paths } from '@/routes/paths';
import type { CalendarEvent } from '@/types/calendar';

interface UpcomingPanelProps {
  events: CalendarEvent[] | undefined;
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
}

const UPCOMING_LIMIT = 5;

/**
 * The next five deadlines and interviews, from the merged calendar stream. Each
 * row is an `UpcomingRow`, which the landing hero's example panel renders too.
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
        // `-mx-2` widens the list, and with it the dividers, to the rows' hover tint;
        // each row's `px-2` puts its text back in line with the heading.
        <ul className="-mx-2 mt-3 divide-y divide-border">
          {upcoming.map((event) => (
            <li key={event.id}>
              <UpcomingRow event={event} to={paths.applicationDetail(event.applicationId)} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
