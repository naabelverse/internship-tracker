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
  /** Public origin of this API, used to build signed download links. */
  API_URL: z.string().url().default('http://localhost:5000'),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'http', 'debug']).default('info'),
  TRUST_PROXY: z.coerce.number().int().min(0).max(10).default(0),

  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  UPLOAD_DIR: z.string().min(1).default('uploads'),
  MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(50).default(5),
  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().min(1).optional(),
  S3_BUCKET: z.string().min(1).optional(),
  S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),

  /**
   * The account `npm run seed` creates. SPEC section 9 fixes these values, and
   * SPEC section 12 signs the "Try the demo" visitor into the same account, so
   * they are configuration rather than constants buried in the seed script.
   * Publishing them is the point: this is a throwaway account holding fixtures.
   */
  DEMO_EMAIL: z.string().email().default('demo@tracker.dev'),
  DEMO_PASSWORD: z.string().min(8).default('Demo@1234'),

  /** Local hour at which a user receives their reminder digest. */
  REMINDER_DIGEST_HOUR: z.coerce.number().int().min(0).max(23).default(8),
  ENABLE_CRON: z.preprocess(
    (value) => (value === undefined ? undefined : value !== 'false' && value !== false),
    z.boolean().default(true),
  ),
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

  if (value.STORAGE_DRIVER === 'local') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['STORAGE_DRIVER'],
      message:
        'must be s3 in production: free tier hosts have ephemeral disks, so local uploads are destroyed on every redeploy',
    });
  }

  for (const key of ['CLIENT_ORIGIN', 'APP_URL', 'API_URL'] as const) {
    if (/^https?:\/\/(localhost|127\.0\.0\.1)/i.test(value[key])) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: 'must point at the deployed origin, not localhost, in production',
      });
    }
  }
});

const S3_REQUIRED_KEYS = [
  'S3_REGION',
  'S3_BUCKET',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
] as const;

/** The S3 driver needs its credentials in every environment, not only production. */
export const envSchemaWithStorage = envSchema.superRefine((value, ctx) => {
  if (value.STORAGE_DRIVER !== 's3') return;

  for (const key of S3_REQUIRED_KEYS) {
    if (!value[key]) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: 'is required when STORAGE_DRIVER is s3',
      });
    }
  }
});

export type Env = z.infer<typeof envSchema>;

/**
 * Drops keys whose value is the empty string.
 *
 * `.env.example` documents optional variables as a bare `KEY=`, and dotenv
 * turns that into an empty string rather than leaving the key unset. Zod's
 * `.optional()` only skips `undefined`, so copying the example file verbatim —
 * the documented setup step — made all five blank `S3_*` keys fail validation
 * and the server refuse to boot even with `STORAGE_DRIVER=local`.
 *
 * Treating blank as absent is also what a reader expects `KEY=` to mean: a
 * defaulted key falls back to its default instead of failing coercion, and a
 * required one reports "is required" rather than a length error.
 */
function withoutBlanks(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== ''),
  ) as NodeJS.ProcessEnv;
}

/**
 * Validates a raw environment bag and returns the typed, defaulted config.
 * Throws with every problem listed at once so a misconfigured deploy is fixed
 * in a single pass instead of one variable per restart.
 */
export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchemaWithStorage.safeParse(withoutBlanks(source));

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
