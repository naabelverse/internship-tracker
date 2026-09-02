/**
 * The single error type the API throws. `code` is a stable, machine-readable
 * string the client can branch on; `message` is safe to show a user.
 */
export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details: unknown;
  readonly isOperational: boolean;

  constructor(statusCode: number, message: string, code = 'INTERNAL_ERROR', details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = true;
    Error.captureStackTrace(this, ApiError);
  }

  static badRequest(message: string, code = 'BAD_REQUEST', details?: unknown): ApiError {
    return new ApiError(400, message, code, details);
  }

  static unauthorized(message = 'Authentication required', code = 'UNAUTHORIZED'): ApiError {
    return new ApiError(401, message, code);
  }

  static forbidden(
    message = 'You do not have access to this resource',
    code = 'FORBIDDEN',
  ): ApiError {
    return new ApiError(403, message, code);
  }

  static notFound(message = 'Resource not found', code = 'NOT_FOUND'): ApiError {
    return new ApiError(404, message, code);
  }

  static conflict(message: string, code = 'CONFLICT', details?: unknown): ApiError {
    return new ApiError(409, message, code, details);
  }

  static tooManyRequests(message = 'Too many requests', code = 'RATE_LIMITED'): ApiError {
    return new ApiError(429, message, code);
  }

  static serviceUnavailable(
    message: string,
    code = 'SERVICE_UNAVAILABLE',
    details?: unknown,
  ): ApiError {
    return new ApiError(503, message, code, details);
  }
}
