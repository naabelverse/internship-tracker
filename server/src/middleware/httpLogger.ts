import type { Request, Response } from 'express';
import morgan from 'morgan';
import { isProduction, isTest } from '@/config/env';
import { logger } from '@/config/logger';

morgan.token<Request, Response>('request-id', (req) => req.id);

const developmentFormat = ':method :url :status :response-time ms';

/** Emits one structured JSON object per request for production log aggregation. */
const productionFormat: morgan.FormatFn<Request, Response> = (tokens, req, res) =>
  JSON.stringify({
    requestId: req.id,
    method: tokens.method(req, res),
    url: tokens.url(req, res),
    status: Number(tokens.status(req, res) ?? 0),
    contentLength: tokens.res(req, res, 'content-length') ?? null,
    responseTimeMs: Number(tokens['response-time'](req, res) ?? 0),
    ip: tokens['remote-addr'](req, res),
    userAgent: tokens['user-agent'](req, res),
  });

const options: morgan.Options<Request, Response> = {
  skip: () => isTest,
  stream: {
    write: (line: string) => {
      if (isProduction) {
        logger.http('http_request', JSON.parse(line) as Record<string, unknown>);
        return;
      }
      logger.http(line.trim());
    },
  },
};

/**
 * Request logging piped into winston, so HTTP lines share the transport,
 * redaction and formatting of every other log line.
 */
export const httpLogger = isProduction
  ? morgan<Request, Response>(productionFormat, options)
  : morgan<Request, Response>(developmentFormat, options);
