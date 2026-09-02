import type { RequestHandler } from 'express';
import { ApiError } from '@/utils/ApiError';

/** Terminal 404 for any request that matched no route. */
export const notFound: RequestHandler = (req, _res, next) => {
  next(ApiError.notFound(`Route ${req.method} ${req.path} not found`, 'ROUTE_NOT_FOUND'));
};
