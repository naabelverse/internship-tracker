import type { Cell } from '@/features/dashboard/heatmapCells';

export interface FollowThroughSummary {
  /** Applications added across the grid's twelve weeks. */
  added: number;
  /** Status changes to applications in the same weeks, openings left out. */
  updates: number;
}

const ratioFormat = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 });

/** The grid's own days summed, so both figures cover exactly the twelve weeks drawn. */
export function summarizeFollowThrough(cells: Cell[]): FollowThroughSummary {
  return cells.reduce<FollowThroughSummary>(
    (sum, cell) => ({ added: sum.added + cell.count, updates: sum.updates + cell.updates }),
    { added: 0, updates: 0 },
  );
}

/**
 * "1.3 updates for every application added". Updates are counted against
 * applications added rather than per application, because the twelve weeks'
 * updates include moves on applications added before them.
 */
export function followThroughText({ added, updates }: FollowThroughSummary): string {
  if (added === 0 && updates === 0) return 'Nothing added or moved in these 12 weeks';
  if (added === 0) return 'No applications added in these 12 weeks';
  if (updates === 0) return 'No status updates yet';

  const ratio = ratioFormat.format(updates / added);

  return `${ratio} ${ratio === '1' ? 'update' : 'updates'} for every application added`;
}
