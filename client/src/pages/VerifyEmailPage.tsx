import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AuthSplitLayout } from '@/features/auth/AuthSplitLayout';
import { verifyEmail } from '@/api/auth';
import { getApiError } from '@/api/errors';
import { paths } from '@/routes/paths';
import { useAuthStore } from '@/store/authStore';

type Outcome = 'working' | 'confirmed' | 'expired' | 'used' | 'missing' | 'failed';

const COPY: Record<Exclude<Outcome, 'working'>, { title: string; body: string }> = {
  confirmed: {
    title: 'Email confirmed',
    body: 'Thanks. Your address is confirmed and your account is fully editable again.',
  },
  expired: {
    title: 'That link has expired',
    body: 'Confirmation links last 24 hours. Sign in and use the Resend link button in the banner to get a fresh one.',
  },
  used: {
    title: 'That link has already been used',
    body: 'Nothing to do here. If your address is already confirmed you can carry on; if you changed your address recently, ask for a new link from Settings.',
  },
  missing: {
    title: 'That link is incomplete',
    body: 'This page needs the token from your confirmation email. Open the link from the email itself rather than typing the address.',
  },
  failed: {
    title: 'That did not work',
    body: 'Your address could not be confirmed just now. Try the link again in a moment, or ask for a new one.',
  },
};

/**
 * Consumes `?token=` from the confirmation email.
 *
 * The server distinguishes an unknown token from an expired one, and so does
 * this page: "expired" and "already used" send the reader somewhere different,
 * and collapsing them into one failure screen would leave someone re-clicking a
 * link that can never work. `INVALID_TOKEN` is reported as already used, which
 * is what it means in practice - the token is cleared off the document the
 * moment it is spent, so a spent token and a fictional one are the same lookup.
 */
export function VerifyEmailPage(): JSX.Element {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [outcome, setOutcome] = useState<Outcome>(token === '' ? 'missing' : 'working');
  const setUser = useAuthStore((state) => state.setUser);
  const attempted = useRef(false);

  useEffect(() => {
    if (token === '' || attempted.current) return;

    // Strict mode runs effects twice in development, and this one spends a
    // single-use token: the second run would report the first as already used.
    attempted.current = true;

    verifyEmail(token)
      .then((user) => {
        // Only refresh a session that is already signed in. Someone confirming
        // from a different device has no session here to update.
        if (useAuthStore.getState().status === 'authenticated') setUser(user);
        setOutcome('confirmed');
      })
      .catch((error: unknown) => {
        const code = getApiError(error)?.code;

        if (code === 'TOKEN_EXPIRED') setOutcome('expired');
        else if (code === 'INVALID_TOKEN') setOutcome('used');
        else setOutcome('failed');
      });
  }, [setUser, token]);

  if (outcome === 'working') {
    return (
      <AuthSplitLayout
        title="Confirming your email"
        subtitle=""
        footer={
          <Link to={paths.login} className="font-medium text-primary hover:underline">
            Go to sign in
          </Link>
        }
      >
        <p role="status" aria-live="polite" className="text-sm text-content-muted">
          One moment.
        </p>
      </AuthSplitLayout>
    );
  }

  const { title, body } = COPY[outcome];

  return (
    <AuthSplitLayout
      title={title}
      subtitle=""
      footer={
        <Link to={paths.login} className="font-medium text-primary hover:underline">
          Go to sign in
        </Link>
      }
    >
      <p
        role={outcome === 'confirmed' ? 'status' : 'alert'}
        data-testid={`verify-${outcome}`}
        className="text-sm text-content"
      >
        {body}
      </p>
    </AuthSplitLayout>
  );
}
