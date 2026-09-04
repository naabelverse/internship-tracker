import { Navigate, Outlet } from 'react-router-dom';
import { useSession } from '@/hooks/useSession';
import { paths } from '@/routes/paths';

/**
 * The public marketing surface: the landing page, Terms and Privacy.
 *
 * SPEC section 12's "logged-in users hitting `/` go straight to the dashboard"
 * lives here and nowhere else. It is a guard rather than a check inside the
 * landing page so the rule cannot be half-applied to one marketing route and
 * forgotten on another.
 *
 * It is a separate guard from `PublicOnlyRoute` for one reason: `pending` must
 * render the page, not a skeleton. On a hard load the session is unknown until
 * the silent refresh answers, and a marketing page showing a grey box for that
 * first moment is worse than useless — it is the largest paint a crawler and a
 * first-time visitor both see. So the page renders immediately, and a signed-in
 * user is redirected once the session is actually known.
 */
export function MarketingRoute(): JSX.Element {
  const { status } = useSession();

  if (status === 'authenticated') return <Navigate to={paths.dashboard} replace />;

  return <Outlet />;
}
