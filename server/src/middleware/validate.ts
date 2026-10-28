import type { RequestHandler } from 'express';
import type { ZodTypeAny } from 'zod';
import { parseOptions } from '@/utils/parseOptions';

/**
 * Validates and replaces `req.body` with the parsed result, so controllers work
 * from typed, coerced data. A ZodError is handed to the central error handler,
 * which maps it to a 400 with per-field messages.
 */
export function validateBody(schema: ZodTypeAny): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req.body, parseOptions);

    if (!result.success) {
      next(result.error);
      return;
    }

    req.body = result.data;
    next();
  };
}

/**
 * Validates `req.query`. Express parses repeated keys into arrays and everything
 * else into strings, so the schema is responsible for coercion.
 */
export function validateQuery(schema: ZodTypeAny): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req.query, parseOptions);

    if (!result.success) {
      next(result.error);
      return;
    }

    req.query = result.data as typeof req.query;
    next();
  };
}

/** Validates route parameters, so a malformed id is a 400 rather than a cast error. */
export function validateParams(schema: ZodTypeAny): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req.params, parseOptions);

    if (!result.success) {
      next(result.error);
      return;
    }

    req.params = result.data as typeof req.params;
    next();
  };
}
