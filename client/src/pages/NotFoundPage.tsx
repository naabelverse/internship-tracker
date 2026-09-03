import { Link } from 'react-router-dom';
import { paths } from '@/routes/paths';

export function NotFoundPage(): JSX.Element {
  return (
    <main className="grid min-h-screen place-items-center bg-canvas px-4">
      <div className="text-center">
        <p className="text-sm font-semibold uppercase tracking-widest text-primary">404</p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight text-content">
          That page does not exist
        </h1>
        <p className="mt-2 text-sm text-content-muted">
          The link may be out of date, or the application may have been deleted.
        </p>
        <Link
          to={paths.dashboard}
          className="mt-6 inline-flex h-11 items-center rounded-control bg-primary px-4 text-sm font-medium text-primary-fg transition-colors hover:bg-primary-hover"
        >
          Back to the dashboard
        </Link>
      </div>
    </main>
  );
}
