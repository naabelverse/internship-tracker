import { apiClient } from '@/api/client';
import type { ApiSuccessBody } from '@/types/api';
import type { CalendarEvent } from '@/types/calendar';

/**
 * Fetches every deadline and interview inside a window. The window is a real
 * request parameter rather than a client-side filter, so moving month asks the
 * server for the new range instead of slicing one fixed payload forever.
 */
export async function getCalendar(from: string, to: string): Promise<CalendarEvent[]> {
  const { data } = await apiClient.get<ApiSuccessBody<{ events: CalendarEvent[] }>>('/calendar', {
    params: { from, to },
  });

  return data.data.events;
}
