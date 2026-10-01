import { StatCard } from '@/features/dashboard/StatCard';
import { WeeklyGoalRing } from '@/features/dashboard/WeeklyGoalRing';
import type { AnalyticsSummary } from '@/types/analytics';

interface StatCardsProps {
  summary: AnalyticsSummary | undefined;
  isLoading: boolean;
}

const plain = (delta: number): string => String(delta);
const points = (delta: number): string => `${String(Math.round(delta * 10) / 10)} pts`;
const days = (value: number): string => {
  const rounded = Math.round(value * 10) / 10;
  return `${String(rounded)} ${rounded === 1 ? 'day' : 'days'}`;
};

/**
 * The six cards SPEC section 6 asks for, plus interview rate and time to first
 * reply, each with a delta. Eight tiles 2 x 4 below `xl` and 4 x 2 from it,
 * so no row is left part-filled.
 *
 * The headline number is the account's standing right now; the delta compares
 * the cohort created in the last period against the cohort created in the one
 * before it, which is what the server returns in `period`.
 */
export function StatCards({ summary, isLoading }: StatCardsProps): JSX.Element {
  const period = summary?.period;
  const periodLabel = period === undefined ? '' : `vs previous ${String(period.days)} days`;

  const delta = (
    pick: (metrics: NonNullable<typeof period>['current']) => number,
  ): number | null => (period === undefined ? null : pick(period.current) - pick(period.previous));

  // A window where nobody heard back has no reply time, so there is nothing to
  // compare against rather than a zero.
  const replyNow = period?.current.avgDaysToFirstResponse ?? null;
  const replyBefore = period?.previous.avgDaysToFirstResponse ?? null;
  const replyDelta = replyNow === null || replyBefore === null ? null : replyNow - replyBefore;
  const replyTime = summary?.avgDaysToFirstResponse ?? null;

  return (
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      <StatCard
        label="Total"
        value={String(summary?.total ?? 0)}
        delta={delta((metrics) => metrics.created)}
        formatDelta={plain}
        periodLabel={periodLabel}
        isLoading={isLoading}
      />
      <StatCard
        label="Active"
        value={String(summary?.active ?? 0)}
        delta={delta((metrics) => metrics.active)}
        formatDelta={plain}
        periodLabel={periodLabel}
        isLoading={isLoading}
      />
      <StatCard
        label="Interviews"
        value={String(summary?.interviewed ?? 0)}
        delta={delta((metrics) => metrics.interviewed)}
        formatDelta={plain}
        periodLabel={periodLabel}
        isLoading={isLoading}
      />
      <StatCard
        label="Offers"
        value={String(summary?.offers ?? 0)}
        delta={delta((metrics) => metrics.offers)}
        formatDelta={plain}
        periodLabel={periodLabel}
        isLoading={isLoading}
      />
      <StatCard
        label="Response rate"
        value={`${String(summary?.responseRate ?? 0)}%`}
        delta={delta((metrics) => metrics.responseRate)}
        formatDelta={points}
        periodLabel={periodLabel}
        isLoading={isLoading}
      />
      <StatCard
        label="Interview rate"
        value={`${String(summary?.interviewRate ?? 0)}%`}
        delta={delta((metrics) => metrics.interviewRate)}
        formatDelta={points}
        periodLabel={periodLabel}
        isLoading={isLoading}
      />
      <StatCard
        label="Time to first reply"
        value={replyTime === null ? '—' : days(replyTime)}
        delta={replyDelta}
        formatDelta={days}
        periodLabel={periodLabel}
        lowerIsBetter
        isLoading={isLoading}
      />
      <StatCard
        label="Weekly goal"
        value={`${String(summary?.weeklyGoal.completed ?? 0)}/${String(summary?.weeklyGoal.target ?? 0)}`}
        delta={
          summary === undefined
            ? null
            : summary.weeklyGoal.completed - summary.weeklyGoal.previousCompleted
        }
        formatDelta={plain}
        periodLabel="vs last week"
        isLoading={isLoading}
      >
        {summary === undefined ? undefined : (
          <WeeklyGoalRing
            completed={summary.weeklyGoal.completed}
            target={summary.weeklyGoal.target}
          />
        )}
      </StatCard>
    </div>
  );
}
