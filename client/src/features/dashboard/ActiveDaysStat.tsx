import type { ActiveDays } from '@/features/dashboard/followThroughStats';

interface ActiveDaysStatProps {
  activeDays: ActiveDays;
  /** Where it shows: the Activity card places one copy per layout and hides the other. */
  className?: string;
}

/**
 * Days with an application added or moved, out of the grid's days so far, as
 * one entry of a description list: the follow-through figures' label and
 * numeral, with the denominator in the label's small text beneath.
 */
export function ActiveDaysStat({ activeDays, className }: ActiveDaysStatProps): JSX.Element {
  return (
    <div className={className}>
      <dt className="text-xs text-content-subtle">Active days</dt>
      <dd className="mt-1 text-stat stretch-display tabular-nums text-content">
        {activeDays.active}
      </dd>
      <dd className="text-xs text-content-subtle">of {activeDays.elapsed} days</dd>
    </div>
  );
}
