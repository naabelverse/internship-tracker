import { dayActivity, type Cell } from '@/features/dashboard/heatmapCells';

export interface FollowThroughSummary {
  /** Applications added across the grid's twelve weeks. */
  added: number;
  /** Status changes to applications in the same weeks, openings left out. */
  updates: number;
}

export interface ActiveDays {
  /** Days with an application added or moved. */
  active: number;
  /** The grid's days up to and including today; the rest of this week is still to come. */
  elapsed: number;
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
 * Days spent on the search: any day an application was added or moved between
 * statuses. Follow-up counts as much as adding, so a day of status changes
 * alone is active. The heatmap shades by the same `dayActivity`, so its shaded
 * squares are these days. Out of the days so far, not all 84: the grid runs to
 * the end of this week, and days that have not happened cannot be active.
 */
export function countActiveDays(cells: Cell[], today: string): ActiveDays {
  const elapsed = cells.filter((cell) => cell.key <= today);

  return {
    active: elapsed.filter((cell) => dayActivity(cell) > 0).length,
    elapsed: elapsed.length,
  };
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
