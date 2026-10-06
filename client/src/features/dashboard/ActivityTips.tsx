import type { ReactNode } from 'react';
import { InfoTip } from '@/components/ui/InfoTip';

/** A term the tip defines, in the panel's own text colour. */
function Term({ children }: { children: ReactNode }): JSX.Element {
  return <span className="font-medium text-content">{children}</span>;
}

/**
 * What a square is and what shades it: `dayActivity`, applications added plus
 * status updates, the same count that makes an active day. So the tip can say
 * the shaded squares add up to the Active days figure.
 */
export function HeatmapTip(): JSX.Element {
  return (
    <InfoTip label="About the heatmap">
      <p>
        Each square is one day. Columns are weeks, oldest on the left, and rows run Monday to
        Sunday.
      </p>
      <p>
        The darker the square, the more you did that day, counting applications added and status
        updates together, compared with your busiest day.
      </p>
      <p>Every shaded square is an active day, so the shaded squares add up to Active days.</p>
    </InfoTip>
  );
}

/** How each of the three figures, and the ratio under them, is counted. */
export function FiguresTip(): JSX.Element {
  return (
    <InfoTip label="About these figures">
      <p>
        <Term>Added</Term>: applications you created in these 12 weeks.
      </p>
      <p>
        <Term>Status updates</Term>: each time you moved an application to a new status, older
        applications included. Adding one doesn’t count as an update.
      </p>
      <p>
        <Term>Active days</Term>: days you added or moved at least one application, out of the days
        so far.
      </p>
      <p>The line under the figures is status updates divided by applications added.</p>
    </InfoTip>
  );
}

interface PaceTipProps {
  /** The account's weekly goal; 0 means none is set. */
  goal: number;
}

/**
 * What a bar is, what meets the goal, and what the average is taken over. The
 * heatmap shades status updates too, so the tip says plainly that they do not
 * count here: otherwise a busy column over a short bar would look like a bug.
 */
export function PaceTip({ goal }: PaceTipProps): JSX.Element {
  return (
    <InfoTip label="About weekly pace">
      <p>
        Each bar is the number of applications you added that week. The last bar is this week so
        far.
      </p>
      <p>
        Only applications added count here and toward your goal. Status updates don’t, so a week of
        follow-ups can look busy on the heatmap and still have a short bar.
      </p>
      <p>
        {goal > 0
          ? `The dashed line is your weekly goal of ${String(goal)}. A week meets it by adding ${String(goal)} or more.`
          : 'No weekly goal is set, so there is no line to meet. You can set one in Settings.'}
      </p>
      <p>The average is everything added across the 12 weeks divided by 12, this week included.</p>
    </InfoTip>
  );
}
