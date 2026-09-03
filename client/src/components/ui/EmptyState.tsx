import type { ReactNode } from 'react';

interface EmptyStateProps {
  title: string;
  message: string;
  action?: ReactNode;
}

/** The explicit empty state CLAUDE.md requires on every async surface. */
export function EmptyState({ title, message, action }: EmptyStateProps): JSX.Element {
  return (
    <div className="rounded-card border border-dashed border-border-strong bg-surface px-6 py-14 text-center">
      <h2 className="text-base font-semibold text-content">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-content-muted">{message}</p>
      {action && <div className="mt-6 flex justify-center">{action}</div>}
    </div>
  );
}
