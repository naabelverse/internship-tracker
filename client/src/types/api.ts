/** Pagination block the API attaches to list responses. */
export interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/** The success half of the API envelope: `{ success, data, message?, meta? }`. */
export interface ApiSuccessBody<T> {
  success: true;
  data: T;
  message?: string;
  meta?: PaginationMeta;
}

/**
 * The error half. `code` is the stable string to branch on; `errors` is the
 * per-field map the server produces for a `VALIDATION_ERROR`.
 */
export interface ApiErrorBody {
  success: false;
  message: string;
  code: string;
  errors?: unknown;
  requestId?: string;
}

/** Field-level messages keyed by the dotted path of the failing field. */
export type FieldErrors = Record<string, string[]>;
