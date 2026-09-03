import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { RouteSkeleton } from '@/components/layout/RouteSkeleton';
import { useSession } from '@/hooks/useSession';
import { paths } from '@/routes/paths';

/**
 * Gate for every authenticated route.
 *
 * `pending` renders a skeleton rather than redirecting: on a hard refresh the
 * access token is gone by design and the session is only known once the silent
 * refresh answers, so treating "not yet known" as "signed out" would eject a
 * signed-in user on every reload. The attempted location is handed to /login so
 * the user lands where they meant to go.
 */
export function ProtectedRoute(): JSX.Element {
  const { status } = useSession();
  const location = useLocation();

  if (status === 'pending') return <RouteSkeleton />;

  if (status === 'anonymous') {
    return (
      <Navigate to={paths.login} replace state={{ from: location.pathname + location.search }} />
    );
  }

  return <Outlet />;
}
