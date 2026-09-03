import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { getCalendar } from '@/api/calendar';
import { queryKeys } from '@/api/queryKeys';
import { monthRange } from '@/features/calendar/monthModel';
import type { CalendarEvent } from '@/types/calendar';

/**
 * The visible window is part of the query key, so moving month issues a new
 * request for the new range rather than re-filtering one fixed payload.
 */
export function useCalendarQuery(month: Date): UseQueryResult<CalendarEvent[]> {
  const { from, to } = monthRange(month);

  return useQuery({
    queryKey: queryKeys.calendar.range(from, to),
    queryFn: () => getCalendar(from, to),
    placeholderData: (previous) => previous,
  });
}
