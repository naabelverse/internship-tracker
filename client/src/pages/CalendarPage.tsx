import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { format, isSameDay } from 'date-fns';
import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/ErrorState';
import { PageHeader } from '@/components/ui/PageHeader';
import { Skeleton } from '@/components/ui/Skeleton';
import { ChevronLeftIcon, ChevronRightIcon } from '@/components/ui/icons';
import { DayEventsPanel } from '@/features/calendar/DayEventsPanel';
import { MonthGrid } from '@/features/calendar/MonthGrid';
import {
  MONTH_PARAM,
  buildMonthGrid,
  formatMonthParam,
  parseMonth,
  shiftMonth,
} from '@/features/calendar/monthModel';
import { useCalendarQuery } from '@/features/calendar/useCalendarQuery';
import { paths } from '@/routes/paths';

function CalendarSkeleton(): JSX.Element {
  return (
    <div className="space-y-4" data-testid="calendar-skeleton">
      <Skeleton className="h-10 w-full" label="Loading the calendar" />
      <Skeleton className="h-[28rem] w-full" />
    </div>
  );
}

export function CalendarPage(): JSX.Element {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);

  // The month lives in the URL for the same reason the table's filters do: the
  // view someone is looking at should survive a refresh and be shareable.
  const month = useMemo(() => parseMonth(searchParams.get(MONTH_PARAM)), [searchParams]);
  const query = useCalendarQuery(month);

  const events = useMemo(() => query.data ?? [], [query.data]);
  const days = useMemo(() => buildMonthGrid(month, events), [month, events]);

  const selectedEvents =
    selectedDate === null
      ? []
      : events.filter((event) => isSameDay(new Date(event.at), selectedDate));

  function goToMonth(step: number): void {
    const next = shiftMonth(month, step);
    setSelectedDate(null);

    const params = new URLSearchParams(searchParams);
    params.set(MONTH_PARAM, formatMonthParam(next));
    setSearchParams(params);
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Calendar"
        description="Deadlines in red, interviews in blue."
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              aria-label="Previous month"
              onClick={() => {
                goToMonth(-1);
              }}
            >
              <ChevronLeftIcon className="h-4 w-4" />
            </Button>

            <p
              aria-live="polite"
              className="min-w-[9rem] text-center text-sm font-medium text-content"
            >
              {format(month, 'MMMM yyyy')}
            </p>

            <Button
              variant="secondary"
              size="sm"
              aria-label="Next month"
              onClick={() => {
                goToMonth(1);
              }}
            >
              <ChevronRightIcon className="h-4 w-4" />
            </Button>
          </div>
        }
      />

      {query.isPending && <CalendarSkeleton />}

      {query.isError && (
        <ErrorState
          error={query.error}
          fallback="The calendar could not be loaded."
          onRetry={() => {
            void query.refetch();
          }}
          isRetrying={query.isFetching}
        />
      )}

      {query.isSuccess && (
        <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
          <MonthGrid days={days} selectedDate={selectedDate} onSelectDay={setSelectedDate} />

          <DayEventsPanel
            date={selectedDate}
            month={month}
            events={selectedEvents}
            onOpenApplication={(applicationId) => {
              void navigate(paths.applicationDetail(applicationId));
            }}
          />
        </div>
      )}
    </div>
  );
}

/** Default export as well, so `React.lazy` can import this route. */
export default CalendarPage;
