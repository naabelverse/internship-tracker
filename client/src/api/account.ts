import { apiClient } from '@/api/client';
import type { ApiSuccessBody } from '@/types/api';

export interface UsageCounter {
  used: number;
  limit: number;
  remaining: number;
}

/** SPEC section 12's per-account ceilings, as the server reports them. */
export interface AccountUsage {
  applications: UsageCounter;
  storageBytes: UsageCounter;
  attachmentsPerApplication: { limit: number };
}

export async function fetchUsage(): Promise<AccountUsage> {
  const { data } = await apiClient.get<ApiSuccessBody<AccountUsage>>('/auth/me/usage');
  return data.data;
}

export interface AccountExportFile {
  filename: string;
  blob: Blob;
}

/** Pulls the filename out of `Content-Disposition`, falling back to a sane one. */
function filenameFrom(header: unknown): string {
  const match = typeof header === 'string' ? /filename="([^"]+)"/.exec(header) : null;

  return match?.[1] ?? 'internship-tracker-export.json';
}

/**
 * Downloads everything the server stores about this account.
 *
 * Requested as a blob rather than as JSON: axios would otherwise parse a file
 * that can run to megabytes into a JavaScript object only for it to be
 * re-serialised on the way to disk. The server names the file, so the name in
 * the download matches the one in its `Content-Disposition`.
 */
export async function fetchAccountExport(): Promise<AccountExportFile> {
  const response = await apiClient.get<Blob>('/auth/me/export', { responseType: 'blob' });

  return {
    filename: filenameFrom(response.headers['content-disposition']),
    blob: response.data,
  };
}
