import { z } from 'zod';

/**
 * Mirrors `server/src/schemas/auth.schema.ts` so a rule the server would reject
 * is caught before the round trip. The server stays the authority: anything that
 * slips through still comes back as a field error and is mapped onto the form.
 */
const email = z
  .string()
  .trim()
  .min(1, 'Enter your email address')
  .email('Enter a valid email address')
  .max(254, 'Use at most 254 characters');

const strongPassword = z
  .string()
  .min(8, 'Use at least 8 characters')
  .max(128, 'Use at most 128 characters')
  .regex(/[a-z]/, 'Include a lowercase letter')
  .regex(/[A-Z]/, 'Include an uppercase letter')
  .regex(/[0-9]/, 'Include a number');

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Enter your password').max(128),
});

export const registerSchema = z.object({
  name: z.string().trim().min(2, 'Use at least 2 characters').max(60, 'Use at most 60 characters'),
  email,
  password: strongPassword,
  acceptTerms: z.literal(true, {
    errorMap: () => ({ message: 'Accept the Terms and Privacy Policy to continue' }),
  }),
});

export type LoginValues = z.infer<typeof loginSchema>;
export type RegisterValues = z.infer<typeof registerSchema>;

/** SPEC section 7: the account's IANA timezone is detected once, at registration. */
export function detectTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}
