import type { ReactNode } from 'react';
import { Skeleton } from '@/components/ui/Skeleton';
import { ArrowDownIcon, ArrowUpIcon } from '@/components/ui/icons';
import { cn } from '@/lib/cn';

export interface StatCardProps {
  label: string;
  /** The headline number, already formatted. */
  value: string;
  /** Signed change against the previous window; null when there is nothing to compare. */
  delta: number | null;
  /** How the delta is written, e.g. "3" or "2.5 points". */
  formatDelta: (delta: number) => string;
  periodLabel: string;
  /** True when a fall is the good outcome, so the colour follows meaning. */
  lowerIsBetter?: boolean;
  isLoading: boolean;
  children?: ReactNode;
}

/**
 * One dashboard statistic with its period delta.
 *
 * Direction is carried by an arrow and by the word "up"/"down" in the label a
 * screen reader gets, not by colour alone, which SPEC section 6 requires.
 */
export function StatCard({
  label,
  value,
  delta,
  formatDelta,
  periodLabel,
  lowerIsBetter = false,
  isLoading,
  children,
}: StatCardProps): JSX.Element {
  const isFlat = delta === null || delta === 0;
  const isUp = delta !== null && delta > 0;
  const isGood = lowerIsBetter ? !isUp : isUp;
  const Arrow = isUp ? ArrowUpIcon : ArrowDownIcon;

  return (
    <div className="rounded-card border border-border bg-surface p-4 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium uppercase tracking-wide text-content-subtle">
            {label}
          </p>
          {isLoading ? (
            <Skeleton className="mt-2 h-8 w-20" label={`Loading ${label}`} />
          ) : (
            <p className="mt-1 text-2xl font-semibold tabular-nums text-content">{value}</p>
          )}
        </div>
        {children}
      </div>

      {!isLoading && (
        <p className="mt-3 flex items-center gap-1.5 text-xs">
          {isFlat ? (
            <span className="text-content-subtle">No change</span>
          ) : (
            <span
              className={cn(
                'inline-flex items-center gap-1 font-medium',
                isGood ? 'text-success' : 'text-danger',
              )}
            >
              <Arrow className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="sr-only">{isUp ? 'Up' : 'Down'}</span>
              {formatDelta(Math.abs(delta))}
            </span>
          )}
          <span className="text-content-subtle">{periodLabel}</span>
        </p>
      )}
    </div>
  );
}
