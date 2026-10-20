import { useSearchParams } from 'react-router-dom';
import { detectTimezone } from '@/features/auth/authSchemas';
import { clientEnv } from '@/lib/env';

export type GoogleIntent = 'login' | 'register';

/**
 * The API route that starts the flow. A full-page navigation, not a request:
 * the browser has to visit Google itself, and the API answers every outcome with
 * a redirect back into this app.
 */
export function googleStartUrl(intent: GoogleIntent): string {
  const url = new URL(`${clientEnv.apiBaseUrl}/auth/google`);
  url.searchParams.set('intent', intent);
  if (intent === 'register') url.searchParams.set('timezone', detectTimezone());

  return url.toString();
}

/** One sentence per code the API's Google callback can send back as `?oauth=`. */
const MESSAGES: Record<string, string> = {
  GOOGLE_UNAVAILABLE: 'Signing in with Google is not available right now. Use your email instead.',
  GOOGLE_CANCELLED: 'Google sign-in was cancelled.',
  GOOGLE_FAILED: 'Google sign-in did not complete. Please try again.',
  GOOGLE_EMAIL_UNVERIFIED:
    'Google has not verified that email address, so it cannot be used to sign in.',
  NO_ACCOUNT: 'No account uses that Google address yet. Create one first.',
  ACCOUNT_UNVERIFIED:
    'An account with that email exists but is not confirmed yet. Sign in with your password and confirm your email, or reset your password, then try Google again.',
  GOOGLE_ACCOUNT_MISMATCH: 'This account is already connected to a different Google account.',
  ACCOUNT_CLOSED:
    'This account is closed. Sign in with your password to restore it, or reset your password first.',
  DEMO_ACCOUNT: 'The demo account cannot be used with Google.',
  DISPOSABLE_EMAIL:
    'That looks like a disposable email address. Please use an address you can receive mail at.',
};

/** The message for a Google sign-in that came back refused, if this page load is one. */
export function useGoogleSignInError(): string | undefined {
  const code = useSearchParams()[0].get('oauth');
  if (code === null) return undefined;

  return MESSAGES[code] ?? MESSAGES.GOOGLE_FAILED;
}
