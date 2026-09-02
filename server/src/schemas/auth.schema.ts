import { z } from 'zod';
import { THEMES } from '@/models/User';

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
    avatarUrl: z.string().url().max(2048).optional(),
    university: z.string().trim().max(120).optional(),
    gradYear: z.number().int().min(1950).max(2100).optional(),
    targetRoles: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
    weeklyGoal: z.number().int().min(0).max(100).optional(),
    theme: z.enum(THEMES).optional(),
    timezone: ianaTimezone.optional(),
    emailRemindersEnabled: z.boolean().optional(),
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

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type UpdateMeInput = z.infer<typeof updateMeSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
