import type { ErrorRequestHandler } from 'express';
import mongoose from 'mongoose';
import { ZodError } from 'zod';
import { isProduction } from '@/config/env';
import { logger } from '@/config/logger';
import { ApiError } from '@/utils/ApiError';
import type { ApiErrorBody } from '@/utils/apiResponse';

interface NormalisedError {
  statusCode: number;
  message: string;
  code: string;
  details?: unknown;
}

interface DuplicateKeyError extends Error {
  code: number;
  keyValue?: Record<string, unknown>;
}

function isDuplicateKeyError(error: unknown): error is DuplicateKeyError {
  return error instanceof Error && (error as Partial<DuplicateKeyError>).code === 11000;
}

function isBodyParseError(error: unknown): boolean {
  return error instanceof SyntaxError && 'body' in error;
}

function isPayloadTooLargeError(error: unknown): boolean {
  return error instanceof Error && (error as Error & { type?: string }).type === 'entity.too.large';
}

/** Flattens a ZodError into `{ field: [messages] }` for form-level display. */
function formatZodIssues(error: ZodError): Record<string, string[]> {
  const fields: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    const existing = fields[key] ?? [];
    existing.push(issue.message);
    fields[key] = existing;
  }
  return fields;
}

/**
 * Turns any thrown value into a status, a stable code and a user-safe message.
 * Database and validation library errors are mapped here so no route has to.
 */
function normalise(error: unknown): NormalisedError {
  if (error instanceof ApiError) {
    return {
      statusCode: error.statusCode,
      message: error.message,
      code: error.code,
      details: error.details,
    };
  }

  if (error instanceof ZodError) {
    return {
      statusCode: 400,
      message: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: formatZodIssues(error),
    };
  }

  if (error instanceof mongoose.Error.ValidationError) {
    const details: Record<string, string[]> = {};
    for (const [field, issue] of Object.entries(error.errors)) {
      details[field] = [issue.message];
    }
    return {
      statusCode: 400,
      message: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details,
    };
  }

  if (error instanceof mongoose.Error.CastError) {
    return {
      statusCode: 400,
      message: `Invalid value for '${error.path}'`,
      code: 'INVALID_IDENTIFIER',
    };
  }

  if (isDuplicateKeyError(error)) {
    const field = Object.keys(error.keyValue ?? {})[0] ?? 'field';
    return {
      statusCode: 409,
      message: `That ${field} is already in use`,
      code: 'DUPLICATE_KEY',
      details: { field },
    };
  }

  if (isPayloadTooLargeError(error)) {
    return { statusCode: 413, message: 'Request body is too large', code: 'PAYLOAD_TOO_LARGE' };
  }

  if (isBodyParseError(error)) {
    return { statusCode: 400, message: 'Request body is not valid JSON', code: 'INVALID_JSON' };
  }

  return {
    statusCode: 500,
    message: 'Something went wrong on our end',
    code: 'INTERNAL_ERROR',
  };
}

/**
 * Central error handler. Must stay the last `app.use` — every thrown error and
 * every `next(err)` ends here, and stack traces never leave the server in production.
 */
export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  const { statusCode, message, code, details } = normalise(error);

  const logPayload = {
    requestId: req.id,
    method: req.method,
    path: req.path,
    statusCode,
    code,
    stack: error instanceof Error ? error.stack : undefined,
  };

  if (statusCode >= 500) {
    logger.error(error instanceof Error ? error.message : String(error), logPayload);
  } else {
    logger.warn(message, { ...logPayload, stack: undefined });
  }

  const body: ApiErrorBody = { success: false, message, code, requestId: req.id };
  if (details !== undefined) body.errors = details;
  if (!isProduction && error instanceof Error) {
    (body as ApiErrorBody & { stack?: string }).stack = error.stack;
  }

  res.status(statusCode).json(body);
};
