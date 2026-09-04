import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { AuthSplitLayout } from '@/features/auth/AuthSplitLayout';
import { paths } from '@/routes/paths';
import { clearAuthState } from '@/store/authStore';

/**
 * Where a closed account lands.
 *
 * The wording is checked against what the server actually does rather than what
 * would be comforting. `login` queries `deletedAt: null`, so a closed account
 * never matches and gets the same `INVALID_CREDENTIALS` a wrong password gets;
 * forgot-password filters the same way. There is no un-delete endpoint anywhere
 * in the API. So this page does not say "you can sign back in to restore it",
 * because that is not true - the only route back that exists is support, inside
 * the 30 day window, which is exactly what the deletion email says too.
 */
export function AccountClosedPage(): JSX.Element {
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
          You have been signed out everywhere and your email address will no longer sign you in.
        </p>
        <p className="text-content-muted">
          Your data is kept for 30 days and then permanently deleted. Within that window, contact
          support if you closed the account by mistake — it cannot be reopened from here.
        </p>
      </div>
    </AuthSplitLayout>
  );
}
