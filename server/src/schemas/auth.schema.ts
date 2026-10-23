import { z } from 'zod';
import { THEMES } from '@/models/User';
import { GOOGLE_INTENTS } from '@/services/googleAuth.service';

/** Rejects a timezone the runtime cannot resolve, so stored values are always usable. */
const ianaTimezone = z.string().refine((value) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}, 'must be a valid IANA timezone name');

const password = z
  .string()
  .min(8, 'must be at least 8 characters')
  .max(128, 'must be at most 128 characters')
  .regex(/[a-z]/, 'must contain a lowercase letter')
  .regex(/[A-Z]/, 'must contain an uppercase letter')
  .regex(/[0-9]/, 'must contain a number');

const email = z.string().trim().toLowerCase().email('must be a valid email address').max(254);

export const registerSchema = z
  .object({
    name: z.string().trim().min(2, 'must be at least 2 characters').max(60),
    email,
    password,
    timezone: ianaTimezone.optional(),
    acceptTerms: z.literal(true, {
      errorMap: () => ({ message: 'you must accept the Terms and Privacy Policy' }),
    }),
    /**
     * Honeypot. The form renders it off-screen and a person never fills it, so
     * any value at all means something filled the form by field name. Accepted
     * by the schema rather than rejected here, so `signupGuard` owns the
     * decision and the response says nothing about which check tripped.
     */
    website: z.string().max(2048).optional(),
    /**
     * Milliseconds between the form mounting and submitting, reported by the
     * client. See `MIN_SIGNUP_FILL_MS` for why this and the honeypot are both
     * optional rather than required.
     */
    elapsedMs: z.number().int().min(0).max(86_400_000).optional(),
  })
  .strict();

export const loginSchema = z
  .object({
    email,
    password: z.string().min(1, 'is required').max(128),
  })
  .strict();

export const updateMeSchema = z
  .object({
    name: z.string().trim().min(2).max(60).optional(),
    // '' clears the picture: Settings sends the whole profile, empty box included.
    avatarUrl: z.string().url().max(2048).or(z.literal('')).optional(),
    university: z.string().trim().max(120).optional(),
    gradYear: z.number().int().min(1950).max(2100).optional(),
    targetRoles: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
    weeklyGoal: z.number().int().min(0).max(100).optional(),
    theme: z.enum(THEMES).optional(),
    timezone: ianaTimezone.optional(),
    emailRemindersEnabled: z.boolean().optional(),
    weeklySummaryEnabled: z.boolean().optional(),
    email: email.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'at least one field must be provided');

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'is required').max(128),
    newPassword: password,
  })
  .strict()
  .refine(
    (value) => value.currentPassword !== value.newPassword,
    'the new password must be different from the current one',
  );

const singleUseToken = z.string().trim().min(1, 'is required').max(512);

export const verifyEmailSchema = z.object({ token: singleUseToken }).strict();

export const forgotPasswordSchema = z.object({ email }).strict();

export const resetPasswordSchema = z.object({ token: singleUseToken, password }).strict();

export const restoreAccountSchema = z.object({ restoreToken: singleUseToken }).strict();

export const deleteAccountSchema = z
  .object({ password: z.string().min(1, 'is required').max(128) })
  .strict();

export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type DeleteAccountInput = z.infer<typeof deleteAccountSchema>;
export type RestoreAccountInput = z.infer<typeof restoreAccountSchema>;

/**
 * Query for `GET /auth/google`. `intent` defaults to `login`, so a bare link can
 * never create an account: only the register page, where the terms are
 * accepted, asks for `register`.
 */
export const googleStartSchema = z.object({
  intent: z.enum(GOOGLE_INTENTS).default('login'),
  timezone: ianaTimezone.optional(),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type UpdateMeInput = z.infer<typeof updateMeSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
