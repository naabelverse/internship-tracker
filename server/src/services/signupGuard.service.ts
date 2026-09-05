import { logger } from '@/config/logger';
import type { RegisterInput } from '@/schemas/auth.schema';
import { ApiError } from '@/utils/ApiError';
import { isDisposableEmail } from '@/utils/disposableDomains';

/**
 * Minimum milliseconds between the registration form mounting and its submit.
 *
 * A person has to read the label, type a name, an address, a password satisfying
 * three character-class rules and tick the terms box. Even with a password
 * manager filling every field, that is several seconds. 2.5 s sits below the
 * plausible human floor - so nobody real is turned away - and far above the
 * milliseconds a script spends between GET and POST.
 */
export const MIN_SIGNUP_FILL_MS = 2_500;

/**
 * The two automation checks are advisory, and both fields are optional.
 *
 * Requiring `elapsedMs` would buy nothing: anything sophisticated enough to
 * strip a field it does not recognise is sophisticated enough to send
 * `elapsedMs: 9999`, while a required field would break every non-browser
 * client. What these actually catch is the naive form-replay bot, which resends
 * whatever the form contained - honeypot included - and posts immediately.
 *
 * The real gates on an open signup are elsewhere and are not advisory: the
 * per-IP and per-email rate limiters on this route, and email verification.
 */
function rejectAsAutomated(reason: string, email: string): never {
  // The address is logged because a signup flood is diagnosed by address
  // pattern; nothing else from the body is, and the logger redacts passwords
  // regardless.
  logger.warn('Registration rejected as automated', { reason, email });

  // Deliberately does not say which check tripped, and stays recoverable: a
  // human who somehow hits it can simply try again.
  throw ApiError.badRequest(
    'That sign-up looked automated. Wait a moment and try again.',
    'SIGNUP_REJECTED',
  );
}

/**
 * SPEC section 12's abuse prevention for an open signup, applied before an
 * account is created or a verification email is queued.
 */
export function assertHumanSignup(input: RegisterInput): void {
  // Named after a field a form-filling bot expects to see and a person never
  // does; the client renders it off-screen and leaves it empty.
  if (typeof input.website === 'string' && input.website.trim().length > 0) {
    rejectAsAutomated('honeypot_filled', input.email);
  }

  if (input.elapsedMs !== undefined && input.elapsedMs < MIN_SIGNUP_FILL_MS) {
    rejectAsAutomated('submitted_too_fast', input.email);
  }

  if (isDisposableEmail(input.email)) {
    throw ApiError.badRequest(
      'That looks like a disposable email address. Please sign up with an address you can receive mail at, so you can confirm your account and reset your password.',
      'DISPOSABLE_EMAIL',
    );
  }
}
