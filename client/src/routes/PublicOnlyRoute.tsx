import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { RouteSkeleton } from '@/components/layout/RouteSkeleton';
import { useSession } from '@/hooks/useSession';
import { readRedirectTarget } from '@/routes/redirectTarget';

/**
 * Keeps a signed-in user off /login and /register. Waiting out `pending` matters
 * here too: rendering the login form first and replacing it a moment later would
 * flash a form the user does not need.
 */
export function PublicOnlyRoute(): JSX.Element {
  const { status } = useSession();
  const location = useLocation();

  if (status === 'pending') return <RouteSkeleton />;
  if (status === 'authenticated') {
    return <Navigate to={readRedirectTarget(location.state)} replace />;
  }

  return <Outlet />;
}
