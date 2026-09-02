import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

const HEADER_NAME = 'x-request-id';

/** Only accept an inbound id that is short and alphanumeric — never echo arbitrary header content. */
const SAFE_ID = /^[A-Za-z0-9_-]{8,128}$/;

/**
 * Assigns a correlation id to every request and echoes it on the response, so a
 * user-reported error can be traced to the exact log lines that produced it.
 */
export const requestId: RequestHandler = (req, res, next) => {
  const inbound = req.get(HEADER_NAME);
  req.id = inbound !== undefined && SAFE_ID.test(inbound) ? inbound : randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
};
