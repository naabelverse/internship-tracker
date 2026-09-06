import winston from 'winston';
import { APP_NAME } from '@/config/app-info';
import { env, isProduction, isTest } from '@/config/env';

const { combine, timestamp, printf, colorize, errors, json } = winston.format;

/** Keys whose values must never reach a log sink. */
const SENSITIVE_KEYS = new Set([
  'password',
  'currentpassword',
  'newpassword',
  'passwordconfirm',
  'token',
  'accesstoken',
  'refreshtoken',
  'tokenhash',
  'authorization',
  'cookie',
  'set-cookie',
  'secret',
  'jwt_access_secret',
  'jwt_refresh_secret',
  'resend_api_key',
  'apikey',
  'html',
  'text',
]);

const REDACTED = '[REDACTED]';
const MAX_DEPTH = 4;

/**
 * Recursively replaces the value of any sensitive key with a marker. Depth is
 * capped so a cyclic or very deep payload cannot stall the logger.
 */
export function redactSecrets(value: unknown, depth = 0): unknown {
  if (depth >= MAX_DEPTH || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => redactSecrets(item, depth + 1));

  // An Error keeps `name`, `message` and `stack` on its prototype as
  // non-enumerable properties, so the generic walk below would produce `{}` and
  // throw away the only part anybody reads. Found in Phase 14: the purge job
  // logged `{ error }` and every failure it ever had was recorded as `error: {}`.
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }

  const output: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    output[key] = SENSITIVE_KEYS.has(key.toLowerCase())
      ? REDACTED
      : redactSecrets(nested, depth + 1);
  }
  return output;
}

/**
 * Redacts metadata in place. Winston carries the routing level and the rendered
 * message on symbol keys, so returning a fresh object here would strip them and
 * break every downstream format.
 */
const redactFormat = winston.format((info) => {
  for (const key of Object.keys(info)) {
    if (key === 'level' || key === 'message') continue;
    info[key] = SENSITIVE_KEYS.has(key.toLowerCase()) ? REDACTED : redactSecrets(info[key], 1);
  }
  return info;
});

const developmentFormat = combine(
  errors({ stack: true }),
  redactFormat(),
  colorize({ level: true }),
  timestamp({ format: 'HH:mm:ss.SSS' }),
  printf((info) => {
    const { level, message, timestamp: at, requestId, stack, service: _service, ...rest } = info;
    const tag = typeof requestId === 'string' ? ` [${requestId.slice(0, 8)}]` : '';
    const extra = Object.keys(rest).length > 0 ? ` ${JSON.stringify(rest)}` : '';
    return `${String(at)} ${level}${tag} ${String(stack ?? message)}${extra}`;
  }),
);

const productionFormat = combine(errors({ stack: true }), redactFormat(), timestamp(), json());

export const logger = winston.createLogger({
  level: env.LOG_LEVEL,
  levels: winston.config.npm.levels,
  format: isProduction ? productionFormat : developmentFormat,
  defaultMeta: { service: APP_NAME },
  transports: [new winston.transports.Console({ silent: isTest })],
  exitOnError: false,
});
