import { z } from 'zod';
import { THEME_PREFERENCES } from '@/types/user';

const CURRENT_YEAR = new Date().getFullYear();
const MAX_GRAD_YEAR = CURRENT_YEAR + 10;

/**
 * Mirrors `updateMeSchema` on the server so the same input is rejected in the
 * same words on both sides. The server stays the authority; this only spares a
 * round trip.
 *
 * The optional fields are strings rather than coerced numbers or URLs because an
 * empty input means "not set", and `z.coerce.number()` turns '' into 0.
 */
export const profileSchema = z.object({
  name: z.string().trim().min(2, 'Use at least 2 characters').max(60, 'Use at most 60 characters'),
  university: z.string().trim().max(120, 'Use at most 120 characters'),
  gradYear: z
    .string()
    .trim()
    .refine((value) => value === '' || /^\d{4}$/.test(value), 'Enter a four digit year')
    .refine(
      (value) => value === '' || (Number(value) >= 1950 && Number(value) <= MAX_GRAD_YEAR),
      `Enter a year between 1950 and ${String(MAX_GRAD_YEAR)}`,
    ),
  avatarUrl: z
    .string()
    .trim()
    .max(2048, 'Use at most 2048 characters')
    .refine(
      (value) => value === '' || z.string().url().safeParse(value).success,
      'Enter a valid URL',
    ),
  targetRoles: z.array(z.string().trim().min(1).max(80)).max(20, 'At most 20 roles'),
});

export const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password'),
    newPassword: z
      .string()
      .min(8, 'Use at least 8 characters')
      .max(128, 'Use at most 128 characters')
      .regex(/[a-z]/, 'Include a lowercase letter')
      .regex(/[A-Z]/, 'Include an uppercase letter')
      .regex(/\d/, 'Include a number'),
    confirmPassword: z.string(),
  })
  .refine((value) => value.newPassword === value.confirmPassword, {
    message: 'Both passwords must match',
    path: ['confirmPassword'],
  })
  .refine((value) => value.newPassword !== value.currentPassword, {
    message: 'Choose a password different from your current one',
    path: ['newPassword'],
  });

export const preferencesSchema = z.object({
  theme: z.enum(THEME_PREFERENCES),
  weeklyGoal: z
    .string()
    .trim()
    .refine((value) => /^\d+$/.test(value), 'Enter a whole number')
    .refine((value) => Number(value) <= 100, 'Use 100 or fewer'),
  timezone: z.string().min(1, 'Choose a timezone'),
  emailRemindersEnabled: z.boolean(),
});

export type ProfileValues = z.infer<typeof profileSchema>;
export type PasswordValues = z.infer<typeof passwordSchema>;
export type PreferencesValues = z.infer<typeof preferencesSchema>;
