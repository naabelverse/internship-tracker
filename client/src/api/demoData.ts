import { apiClient } from '@/api/client';
import type { ApiSuccessBody } from '@/types/api';

/**
 * Fills an empty account with the fixture set behind the dashboard empty state.
 * SPEC section 9's seed is a CLI script, which a browser cannot run, so this
 * endpoint is the bridge; the server refuses any account that already holds
 * applications, so it can never mix demo rows into real data.
 */
export async function loadDemoData(): Promise<number> {
  const { data } =
    await apiClient.post<ApiSuccessBody<{ inserted: number }>>('/applications/demo-data');

  return data.data.inserted;
}
