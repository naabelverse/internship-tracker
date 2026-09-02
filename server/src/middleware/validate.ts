import type { RequestHandler } from 'express';
import type { ZodTypeAny } from 'zod';

/**
 * Validates and replaces `req.body` with the parsed result, so controllers work
 * from typed, coerced data. A ZodError is handed to the central error handler,
 * which maps it to a 400 with per-field messages.
 */
export function validateBody(schema: ZodTypeAny): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      next(result.error);
      return;
    }

    req.body = result.data;
    next();
  };
}
