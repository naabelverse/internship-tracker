import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

/** Minimum length for any secret used to sign tokens in production. */
export const MIN_SECRET_LENGTH = 32;

/**
 * Placeholder values shipped in `.env.example`. Reaching production with any of
 * these means the deploy was never configured, so boot must fail loudly.
 */
export const EXAMPLE_SECRET_VALUES: readonly string[] = [
  'change-me',
  'changeme',
  'secret',
  'replace-with-a-long-random-string',
  'generate-with-openssl-rand-base64-48',
];

const baseSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(5000),
  MONGO_URI: z.string().min(1, 'MONGO_URI is required'),
  JWT_ACCESS_SECRET: z.string().min(1, 'JWT_ACCESS_SECRET is required'),
  JWT_REFRESH_SECRET: z.string().min(1, 'JWT_REFRESH_SECRET is required'),
  ACCESS_TOKEN_TTL: z.string().min(1).default('15m'),
  REFRESH_TOKEN_TTL: z.string().min(1).default('7d'),
  CLIENT_ORIGIN: z.string().url().default('http://localhost:5173'),
  APP_URL: z.string().url().default('http://localhost:5173'),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'http', 'debug']).default('info'),
  TRUST_PROXY: z.coerce.number().int().min(0).max(10).default(0),
});

const SECRET_KEYS = ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'] as const;

/**
 * Production-only hardening. Development stays permissive so the app runs with
 * nothing but MONGO_URI and the two JWT secrets set.
 */
export const envSchema = baseSchema.superRefine((value, ctx) => {
  if (value.NODE_ENV !== 'production') return;

  for (const key of SECRET_KEYS) {
    const secret = value[key];
    if (secret.length < MIN_SECRET_LENGTH) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: `must be at least ${MIN_SECRET_LENGTH} characters in production`,
      });
    }
    if (EXAMPLE_SECRET_VALUES.includes(secret)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: 'is still the placeholder value from .env.example',
      });
    }
  }

  if (value.JWT_ACCESS_SECRET === value.JWT_REFRESH_SECRET) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['JWT_REFRESH_SECRET'],
      message: 'must differ from JWT_ACCESS_SECRET',
    });
  }

  for (const key of ['CLIENT_ORIGIN', 'APP_URL'] as const) {
    if (/^https?:\/\/(localhost|127\.0\.0\.1)/i.test(value[key])) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: 'must point at the deployed origin, not localhost, in production',
      });
    }
  }
});

export type Env = z.infer<typeof envSchema>;

/**
 * Validates a raw environment bag and returns the typed, defaulted config.
 * Throws with every problem listed at once so a misconfigured deploy is fixed
 * in a single pass instead of one variable per restart.
 */
export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || 'env'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }

  return result.data;
}

export const env = parseEnv();
export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
export const isDevelopment = env.NODE_ENV === 'development';
