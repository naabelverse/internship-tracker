import { useMemo, type ReactNode } from 'react';
import type { Cell } from '@/features/dashboard/heatmapCells';
import { followThroughText, summarizeFollowThrough } from '@/features/dashboard/followThroughStats';

interface FollowThroughProps {
  /** The heatmap's own cells, so both figures cover the same twelve weeks. */
  cells: Cell[];
  /** Further figures for the same row, each a `div` holding a `dt` and its `dd`s. */
  children?: ReactNode;
  /** An explanation of the figures and the line under them, set beside the title. */
  info?: ReactNode;
}

/**
 * Applications added against the status updates made to them, over the grid's
 * twelve weeks. A titled section like Weekly pace: the title and its tip, then
 * labels in the pace panel's small subtle text over the stat cards' display
 * numerals, so it reads as part of the same card.
 *
 * The figures share the row in equal columns, none narrower than its own
 * content: spread across a wide column, and never wrapped in a narrow one.
 * Added, Status updates and Active days need 177px plus two 16px gaps, inside
 * the Activity card's 240px floor for this column and its 226px grid at 320.
 *
 * The ratio under them is their caption, in the style of "of N days" and 4px
 * under the row, with no tip of its own: given one, it read as a heading for
 * the Weekly pace panel below.
 */
export function FollowThrough({ cells, children, info }: FollowThroughProps): JSX.Element {
  const summary = useMemo(() => summarizeFollowThrough(cells), [cells]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <h3 className="text-xs text-content-subtle">Follow-through</h3>
        {info}
      </div>
      <div>
        <dl className="grid auto-cols-[minmax(max-content,1fr)] grid-flow-col gap-x-4">
          <div>
            <dt className="text-xs text-content-subtle">Added</dt>
            <dd className="mt-1 text-stat stretch-display tabular-nums text-content">
              {summary.added}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-content-subtle">Status updates</dt>
            <dd className="mt-1 text-stat stretch-display tabular-nums text-content">
              {summary.updates}
            </dd>
          </div>
          {children}
        </dl>
        <p className="mt-1 text-xs text-content-subtle">{followThroughText(summary)}</p>
      </div>
    </div>
  );
}
