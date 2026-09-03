import { Button } from '@/components/ui/Button';
import { AlertIcon } from '@/components/ui/icons';
import { getErrorMessage } from '@/api/errors';

interface ErrorStateProps {
  error: unknown;
  fallback: string;
  onRetry: () => void;
  isRetrying?: boolean;
}

/** The explicit error state with a retry, for a query that failed. */
export function ErrorState({
  error,
  fallback,
  onRetry,
  isRetrying = false,
}: ErrorStateProps): JSX.Element {
  return (
    <div
      role="alert"
      className="rounded-card border border-danger/40 bg-danger/5 px-6 py-12 text-center"
    >
      <AlertIcon className="mx-auto h-7 w-7 text-danger" />
      <h2 className="mt-3 text-base font-semibold text-content">That did not load</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-content-muted">
        {getErrorMessage(error, fallback)}
      </p>
      <Button className="mt-6" onClick={onRetry} isLoading={isRetrying} loadingLabel="Retrying">
        Try again
      </Button>
    </div>
  );
}
