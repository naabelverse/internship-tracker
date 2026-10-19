import type { ReactNode } from 'react';
import { Card } from '@/components/ui/Card';
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
  /** A graphic beside the figures, centred on all three lines of them. */
  children?: ReactNode;
  /** An `InfoTip` after the label, for a figure whose basis needs saying. */
  tip?: ReactNode;
}

/**
 * One dashboard statistic with its period delta.
 *
 * Direction is carried by an arrow and by the word "up"/"down" in the label a
 * screen reader gets, not by colour alone, which SPEC section 6 requires.
 *
 * A card with a graphic becomes a flex row only then. The graphic used to sit
 * in a row with the label and value alone, pinned to the top corner above an
 * empty quarter of the card; centring it on the delta line too fills that
 * space. The text keeps its top alignment either way, so labels stay level
 * across a grid row whose cards stretch to different content heights.
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
  tip,
}: StatCardProps): JSX.Element {
  const isFlat = delta === null || delta === 0;
  const isUp = delta !== null && delta > 0;
  const isGood = lowerIsBetter ? !isUp : isUp;
  const Arrow = isUp ? ArrowUpIcon : ArrowDownIcon;

  const hasGraphic = children !== undefined;

  return (
    <Card className={hasGraphic ? 'flex gap-3' : undefined}>
      <div className="min-w-0 flex-1">
        {tip === undefined ? (
          <p className="truncate text-xs font-medium text-content-subtle">{label}</p>
        ) : (
          <div className="flex items-center gap-1">
            <p className="truncate text-xs font-medium text-content-subtle">{label}</p>
            {tip}
          </div>
        )}
        {isLoading ? (
          <Skeleton className="mt-2 h-8 w-20" label={`Loading ${label}`} />
        ) : (
          <p className="mt-1 text-stat stretch-display tabular-nums text-content">{value}</p>
        )}

        {!isLoading && (
          // Wraps between the change and its period, never inside either, so a
          // narrow card reads "↑ 32.3 pts" over "vs previous 30 days" rather
          // than splitting "32.3" from "pts" or "No" from "change".
          <p className="mt-3 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs">
            {isFlat ? (
              <span className="whitespace-nowrap text-content-subtle">No change</span>
            ) : (
              <span
                className={cn(
                  'inline-flex items-center gap-1 whitespace-nowrap font-medium',
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
      {hasGraphic && <div className="shrink-0 self-center">{children}</div>}
    </Card>
  );
}
