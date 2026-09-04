import type { ReactNode } from 'react';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';

interface ChartFrameProps {
  title: string;
  description?: string;
  /** Filter switches and the like, rendered against the title. */
  controls?: ReactNode;
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  /** True when the request succeeded but there is nothing to draw. */
  isEmpty: boolean;
  emptyMessage: string;
  /** Tailwind height for the canvas box; charts need a sized parent. */
  heightClass?: string;
  children: ReactNode;
}

/**
 * The card every chart sits in, and the one place the loading, empty and error
 * states are handled, so no chart can quietly render an empty canvas.
 */
export function ChartFrame({
  title,
  description,
  controls,
  isLoading,
  error,
  onRetry,
  isEmpty,
  emptyMessage,
  heightClass = 'h-64',
  children,
}: ChartFrameProps): JSX.Element {
  return (
    <section className="rounded-card border border-border bg-surface p-4 shadow-card sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-content">{title}</h2>
          {description !== undefined && (
            <p className="mt-0.5 text-xs text-content-subtle">{description}</p>
          )}
        </div>
        {controls}
      </div>

      <div className={`mt-4 ${heightClass}`}>
        {isLoading ? (
          <Skeleton className="h-full w-full" label={`Loading ${title}`} />
        ) : error !== null ? (
          <ErrorState error={error} fallback={`${title} could not load.`} onRetry={onRetry} />
        ) : isEmpty ? (
          <p className="flex h-full items-center justify-center rounded-control border border-dashed border-border-strong px-4 text-center text-sm text-content-muted">
            {emptyMessage}
          </p>
        ) : (
          children
        )}
      </div>
    </section>
  );
}
