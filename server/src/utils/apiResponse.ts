import type { Response } from 'express';

export interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ApiSuccessBody<T> {
  success: true;
  data: T;
  message?: string;
  meta?: PaginationMeta;
}

export interface ApiErrorBody {
  success: false;
  message: string;
  code: string;
  errors?: unknown;
  requestId?: string;
}

interface SendSuccessOptions {
  status?: number;
  message?: string;
  meta?: PaginationMeta;
}

/** Writes the standard success envelope: `{ success, data, message?, meta? }`. */
export function sendSuccess<T>(res: Response, data: T, options: SendSuccessOptions = {}): Response {
  const { status = 200, message, meta } = options;
  const body: ApiSuccessBody<T> = { success: true, data };
  if (message !== undefined) body.message = message;
  if (meta !== undefined) body.meta = meta;
  return res.status(status).json(body);
}
