import { format, isSameDay } from 'date-fns';
import { cn } from '@/lib/cn';
import { EVENT_TONE, type CalendarDay } from '@/features/calendar/monthModel';
import { Card } from '@/components/ui/Card';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

interface MonthGridProps {
  days: CalendarDay[];
  selectedDate: Date | null;
  onSelectDay: (date: Date) => void;
}

/** Splits the flat 42-day list into calendar weeks, for the `role="row"` wrappers. */
function toWeeks(days: CalendarDay[]): CalendarDay[][] {
  const weeks: CalendarDay[][] = [];
  for (let index = 0; index < days.length; index += 7) weeks.push(days.slice(index, index + 7));
  return weeks;
}

export function MonthGrid({ days, selectedDate, onSelectDay }: MonthGridProps): JSX.Element {
  const weeks = toWeeks(days);

  return (
    <Card padding="none" className="overflow-hidden">
      <div className="grid grid-cols-7 border-b border-border">
        {WEEKDAYS.map((weekday) => (
          <div
            key={weekday}
            className="px-2 py-2 text-center text-xs font-medium text-content-subtle"
          >
            {weekday}
          </div>
        ))}
      </div>

      {/*
        Weeks are wrapped in `role="row"` because a `grid` may not own gridcells
        directly -- axe reports aria-required-children on the grid and
        aria-required-parent on all 42 cells without them. `display: contents`
        means the wrapper contributes no box, so every cell still lays out in the
        parent's seven columns exactly as before and the DOM order is unchanged.
      */}
      <div role="grid" aria-label="Month" className="grid grid-cols-7">
        {weeks.map((week, weekIndex) => (
          <div key={weekIndex} role="row" className="contents">
            {week.map((day) => {
              const isSelected = selectedDate !== null && isSameDay(day.date, selectedDate);

              return (
                <button
                  key={day.date.toISOString()}
                  type="button"
                  role="gridcell"
                  aria-selected={isSelected}
                  aria-label={`${format(day.date, 'd MMMM yyyy')}, ${String(day.events.length)} events`}
                  onClick={() => {
                    onSelectDay(day.date);
                  }}
                  className={cn(
                    // A button centres its content vertically by default; flex-col pins
                    // the day number to the top whether or not the day has events.
                    'flex min-h-[5.5rem] flex-col items-start border-b border-r border-border p-1.5 text-left transition-colors',
                    day.inMonth ? 'bg-surface' : 'bg-surface-muted/40',
                    isSelected && 'ring-2 ring-inset ring-primary',
                    'hover:bg-surface-muted',
                  )}
                >
                  <span
                    className={cn(
                      'inline-flex h-6 w-6 items-center justify-center rounded-full text-xs',
                      day.isToday
                        ? 'bg-primary-fill font-semibold text-primary-fill-fg'
                        : 'text-content-muted',
                      !day.inMonth && 'text-content-subtle',
                    )}
                  >
                    {format(day.date, 'd')}
                  </span>

                  <span className="mt-1 block w-full space-y-1">
                    {day.events.slice(0, 2).map((event) => (
                      <span
                        key={event.id}
                        className={cn(
                          'block truncate rounded-chip px-1.5 py-0.5 text-[0.7rem]',
                          EVENT_TONE[event.kind],
                        )}
                      >
                        {event.company}
                      </span>
                    ))}

                    {day.events.length > 2 && (
                      <span className="block px-1.5 text-[0.7rem] text-content-subtle">
                        +{day.events.length - 2} more
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </Card>
  );
}
