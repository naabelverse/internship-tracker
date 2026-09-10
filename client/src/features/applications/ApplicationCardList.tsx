import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/Badge';
import { EditIcon } from '@/components/ui/icons';
import { DeadlineChip } from '@/features/applications/DeadlineChip';
import { StatusSelect } from '@/features/applications/StatusSelect';
import { companyInitials } from '@/lib/formatters';
import { PRIORITY_CONFIG } from '@/lib/statusConfig';
import { cn } from '@/lib/cn';
import { paths } from '@/routes/paths';
import type { Application, ApplicationStatus } from '@/types/application';
import { Card } from '@/components/ui/Card';

interface ApplicationCardListProps {
  applications: Application[];
  selectedIds: string[];
  pendingStatusIds: string[];
  onToggle: (id: string) => void;
  onStatusChange: (id: string, status: ApplicationStatus) => void;
  onEdit: (id: string) => void;
}

/**
 * The narrow-viewport view. SPEC section 6 asks for stacked cards at 375 px
 * rather than a table that scrolls sideways, so this is a genuinely different
 * layout rather than the same grid with smaller text.
 */
export function ApplicationCardList({
  applications,
  selectedIds,
  pendingStatusIds,
  onToggle,
  onStatusChange,
  onEdit,
}: ApplicationCardListProps): JSX.Element {
  return (
    <ul className="space-y-3">
      {applications.map((application) => (
        <Card as="li" padding="compact" key={application.id}>
          <div className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={selectedIds.includes(application.id)}
              onChange={() => {
                onToggle(application.id);
              }}
              aria-label={`Select ${application.company}`}
              className="mt-1 h-4 w-4 shrink-0 rounded-chip border-border-strong accent-[rgb(var(--color-primary))]"
            />

            <span
              aria-hidden="true"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-control bg-surface-muted text-sm font-semibold text-content-muted"
            >
              {companyInitials(application.company)}
            </span>

            <div className="min-w-0 flex-1">
              <Link
                to={paths.applicationDetail(application.id)}
                className="block truncate font-medium text-content transition-colors hover:text-primary"
              >
                {application.company}
              </Link>
              <p className="truncate text-sm text-content-muted">{application.role}</p>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <StatusSelect
                  value={application.status}
                  label={`Status for ${application.company}`}
                  disabled={pendingStatusIds.includes(application.id)}
                  onChange={(status) => {
                    onStatusChange(application.id, status);
                  }}
                />
                <DeadlineChip deadline={application.deadline} />
                <Badge className="bg-surface-muted text-content-muted">
                  <span
                    aria-hidden="true"
                    className={cn(
                      'h-1.5 w-1.5 rounded-full',
                      PRIORITY_CONFIG[application.priority].dot,
                    )}
                  />
                  {PRIORITY_CONFIG[application.priority].label}
                </Badge>
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                onEdit(application.id);
              }}
              aria-label={`Edit ${application.company}`}
              className="rounded-control p-1.5 text-content-subtle transition-colors hover:bg-surface-muted hover:text-content"
            >
              <EditIcon className="h-4 w-4" />
            </button>
          </div>
        </Card>
      ))}
    </ul>
  );
}
