import { useMemo } from 'react';
import type { Cell } from '@/features/dashboard/heatmapCells';
import { followThroughText, summarizeFollowThrough } from '@/features/dashboard/followThroughStats';

interface FollowThroughProps {
  /** The heatmap's own cells, so both figures cover the same twelve weeks. */
  cells: Cell[];
}

/**
 * Applications added against the status updates made to them, over the grid's
 * twelve weeks. Labels are the pace panel's small subtle text and the figures
 * are the stat cards' display numerals, so it reads as part of the same card.
 */
export function FollowThrough({ cells }: FollowThroughProps): JSX.Element {
  const summary = useMemo(() => summarizeFollowThrough(cells), [cells]);

  return (
    <div className="flex flex-col gap-2">
      <dl className="flex flex-wrap gap-x-8 gap-y-2">
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
      </dl>
      <p className="text-xs text-content-subtle">{followThroughText(summary)}</p>
    </div>
  );
}
