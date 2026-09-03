import { Badge } from '@/components/ui/Badge';
import { daysUntil, formatDate } from '@/lib/formatters';

/**
 * SPEC section 6: amber at three days or fewer, red once the deadline has passed.
 * Lives here rather than in the table because Phase 7's board cards use it too.
 */
export function DeadlineChip({ deadline }: { deadline?: string }): JSX.Element {
  const days = daysUntil(deadline);

  if (days === null) return <span className="text-content-subtle">—</span>;

  const tone =
    days < 0
      ? 'bg-danger/15 text-danger'
      : days <= 3
        ? 'bg-warning/15 text-warning'
        : 'bg-surface-muted text-content-muted';

  const suffix =
    days < 0
      ? `overdue by ${String(Math.abs(days))}d`
      : days === 0
        ? 'today'
        : `in ${String(days)}d`;

  return (
    <Badge className={tone}>
      <span className="sr-only">Deadline {formatDate(deadline)}, </span>
      {suffix}
    </Badge>
  );
}
