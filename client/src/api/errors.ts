import axios from 'axios';
import type { ApiErrorBody, FieldErrors } from '@/types/api';

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== 'object' || value === null) return false;

  const body = value as Partial<ApiErrorBody>;
  return (
    body.success === false && typeof body.message === 'string' && typeof body.code === 'string'
  );
}

/** Returns the API's error envelope, or null for a transport or unknown failure. */
export function getApiError(error: unknown): ApiErrorBody | null {
  if (!axios.isAxiosError(error)) return null;

  const data: unknown = error.response?.data;
  return isApiErrorBody(data) ? data : null;
}

/** The stable machine-readable code, so callers branch on it instead of prose. */
export function getApiErrorCode(error: unknown): string | null {
  return getApiError(error)?.code ?? null;
}

/** A message safe to show a user, falling back when the server said nothing useful. */
export function getErrorMessage(error: unknown, fallback: string): string {
  const body = getApiError(error);
  if (body) return body.message;

  if (axios.isAxiosError(error) && error.code === 'ECONNABORTED') {
    return 'The request timed out. Check your connection and try again.';
  }

  if (axios.isAxiosError(error) && !error.response) {
    return 'Could not reach the server. Check your connection and try again.';
  }

  return fallback;
}

/**
 * Narrows the `errors` payload of a `VALIDATION_ERROR` into the `{ field: messages }`
 * shape react-hook-form's `setError` needs. Anything else yields an empty map, so
 * a caller can fall back to a form-level message.
 */
export function getFieldErrors(error: unknown): FieldErrors {
  const details = getApiError(error)?.errors;
  if (typeof details !== 'object' || details === null || Array.isArray(details)) return {};

  const fields: FieldErrors = {};
  for (const [field, messages] of Object.entries(details as Record<string, unknown>)) {
    if (Array.isArray(messages) && messages.every((entry) => typeof entry === 'string')) {
      fields[field] = messages;
    } else if (typeof messages === 'string') {
      fields[field] = [messages];
    }
  }

  return fields;
}
