import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { AlertIcon } from '@/components/ui/icons';
import { logger } from '@/lib/logger';
import { reportError } from '@/lib/sentry';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Top-level boundary. A render error inside the app produces a readable panel
 * with a retry rather than a blank white page. Retry clears the captured error
 * and re-renders the subtree, which recovers from a transient failure without a
 * full reload; the reload button remains for anything that does not.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    logger.error('Unhandled render error', { message: error.message, stack: info.componentStack });
    // A no-op unless VITE_SENTRY_DSN is set. This is the one place a render
    // error is caught, so it is the one place worth reporting from.
    void reportError(error, { componentStack: info.componentStack });
  }

  private readonly handleRetry = (): void => {
    this.setState({ error: null });
  };

  private readonly handleReload = (): void => {
    window.location.reload();
  };

  override render(): ReactNode {
    const { error } = this.state;

    if (!error) return this.props.children;

    return (
      <div className="grid min-h-screen place-items-center bg-canvas p-6">
        <div
          role="alert"
          className="w-full max-w-md rounded-card border border-border bg-surface p-6 shadow-card"
        >
          <AlertIcon className="h-8 w-8 text-danger" />
          <h1 className="mt-4 text-lg font-semibold text-content">Something broke on this page</h1>
          <p className="mt-2 text-sm text-content-muted">
            The rest of the app is fine. Try again, and reload if it keeps happening.
          </p>
          <p className="mt-3 break-words rounded-control bg-surface-muted p-3 text-xs text-content-subtle">
            {error.message}
          </p>

          <div className="mt-5 flex gap-2">
            <Button onClick={this.handleRetry}>Try again</Button>
            <Button variant="secondary" onClick={this.handleReload}>
              Reload page
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
