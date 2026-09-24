import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { formatPurgeDate } from '@/features/auth/accountClosure';
import { AuthSplitLayout } from '@/features/auth/AuthSplitLayout';
import { paths } from '@/routes/paths';
import { clearAuthState } from '@/store/authStore';

/** The purge date the delete mutation passes in route state, if the page was reached that way. */
function readPurgeAt(state: unknown): string | null {
  const purgeAt = (state as { purgeAt?: unknown } | null)?.purgeAt;
  return typeof purgeAt === 'string' ? purgeAt : null;
}

/**
 * Where a closed account lands.
 *
 * The wording is checked against what the server actually does. Signing in with
 * the same password before the purge date offers a restore; that is the only way
 * back, and there is no support channel that can do it instead. Forgot-password
 * filters out closed accounts on purpose, so a forgotten password means the
 * account cannot be restored - which is why that sentence is a bordered callout
 * rather than muted small print.
 *
 * A reload loses the route state, so every date has a wording that still holds
 * without one.
 */
export function AccountClosedPage(): JSX.Element {
  const purgeAt = readPurgeAt(useLocation().state);
  const date = purgeAt ? formatPurgeDate(purgeAt) : null;
  const until = date ? `until ${date}` : 'for 30 days';
  const before = date ? `before ${date}` : 'within 30 days of closing it';
  const on = date ? `on ${date}` : 'when those 30 days end';

  useEffect(() => {
    // The session is already dead server-side; this drops the local copy. Done
    // here rather than at the call site so it cannot race the navigation.
    clearAuthState();
  }, []);

  return (
    <AuthSplitLayout
      title="Your account is closed"
      subtitle=""
      footer={
        <Link to={paths.login} className="font-medium text-primary hover:underline">
          Back to sign in
        </Link>
      }
    >
      <div className="space-y-3 text-sm text-content">
        <p role="status">
          You have been signed out everywhere. Your account and its records are kept {until}, then
          permanently deleted.
        </p>
        <p>
          Changed your mind? Sign in with your email and password {before}. You will be asked
          whether to restore the account, and everything comes back as you left it.
        </p>
        <p className="rounded-control border border-warning/50 bg-warning/10 p-3 font-medium">
          If you have forgotten your password, you cannot restore this account yourself. Password
          reset does not work for a closed account, so your account and its records will be
          permanently deleted {on}.
        </p>
      </div>
    </AuthSplitLayout>
  );
}

/** Default export as well, so `React.lazy` can import this route. */
export default AccountClosedPage;
