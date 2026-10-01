import { apiClient } from '@/api/client';
import { filenameFrom, type DownloadedFile } from '@/lib/download';
import type { ApplicationFilters } from '@/features/applications/filterParams';
import { toQueryParams } from '@/features/applications/filterParams';
import type { ApiSuccessBody, PaginationMeta } from '@/types/api';
import type { Application, ApplicationStatus, BulkAction, BulkResult } from '@/types/application';

export interface ApplicationListPage {
  applications: Application[];
  meta: PaginationMeta;
}

/** Fields the API accepts on create and update; derived fields are rejected server-side. */
export interface ApplicationPayload {
  company?: string;
  role?: string;
  companyWebsite?: string;
  location?: string;
  workMode?: string;
  employmentType?: string;
  status?: string;
  priority?: string;
  source?: string;
  sourceOther?: string;
  jobUrl?: string;
  appliedDate?: string;
  deadline?: string;
  resumeVersion?: string;
  tags?: string[];
  notes?: string;
  archived?: boolean;
  /** Sent on update so the server can reject a write built on a stale read. */
  version?: number;
}

export async function listApplications(filters: ApplicationFilters): Promise<ApplicationListPage> {
  const { data } = await apiClient.get<ApiSuccessBody<{ applications: Application[] }>>(
    '/applications',
    { params: toQueryParams(filters) },
  );

  return {
    applications: data.data.applications,
    meta: data.meta ?? { total: 0, page: 1, limit: filters.limit, totalPages: 0 },
  };
}

export async function getApplication(id: string): Promise<Application> {
  const { data } = await apiClient.get<ApiSuccessBody<{ application: Application }>>(
    `/applications/${id}`,
  );
  return data.data.application;
}

export async function createApplication(payload: ApplicationPayload): Promise<Application> {
  const { data } = await apiClient.post<ApiSuccessBody<{ application: Application }>>(
    '/applications',
    payload,
  );
  return data.data.application;
}

export async function updateApplication(
  id: string,
  payload: ApplicationPayload,
): Promise<Application> {
  const { data } = await apiClient.patch<ApiSuccessBody<{ application: Application }>>(
    `/applications/${id}`,
    payload,
  );
  return data.data.application;
}

export async function changeStatus(
  id: string,
  status: ApplicationStatus,
  note?: string,
): Promise<Application> {
  const body = note === undefined ? { status } : { status, note };
  const { data } = await apiClient.patch<ApiSuccessBody<{ application: Application }>>(
    `/applications/${id}/status`,
    body,
  );
  return data.data.application;
}

export async function deleteApplication(id: string): Promise<void> {
  await apiClient.delete(`/applications/${id}`);
}

export async function bulkAction(
  ids: string[],
  action: BulkAction,
  status?: ApplicationStatus,
): Promise<BulkResult> {
  const body = action === 'setStatus' ? { ids, action, payload: { status } } : { ids, action };

  const { data } = await apiClient.post<ApiSuccessBody<BulkResult>>('/applications/bulk', body);
  return data.data;
}

/**
 * Downloads the account's applications as a file.
 *
 * SPEC section 5 exposes `GET /applications/export?format=csv|json`; the CSV is
 * what the toolbar offers, because a spreadsheet is what someone tracking a job
 * search actually opens it in. Requested as a blob for the same reason the
 * account export is: axios would otherwise parse the whole file into a
 * JavaScript value only for it to be re-serialised on the way to disk.
 */
export async function exportApplications(format: 'csv' | 'json'): Promise<DownloadedFile> {
  const response = await apiClient.get<Blob>('/applications/export', {
    params: { format },
    responseType: 'blob',
  });

  return {
    filename: filenameFrom(response.headers['content-disposition'], `applications.${format}`),
    blob: response.data,
  };
}
