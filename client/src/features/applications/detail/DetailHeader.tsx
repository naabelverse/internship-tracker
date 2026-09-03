import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import {
  ArchiveIcon,
  EditIcon,
  ExternalLinkIcon,
  PlusIcon,
  TrashIcon,
} from '@/components/ui/icons';
import { StatusSelect } from '@/features/applications/StatusSelect';
import { companyInitials } from '@/lib/formatters';
import { EMPLOYMENT_TYPE_LABELS, WORK_MODE_LABELS } from '@/lib/statusConfig';
import type { Application, ApplicationStatus } from '@/types/application';

interface DetailHeaderProps {
  application: Application;
  isStatusPending: boolean;
  isArchivePending: boolean;
  onStatusChange: (status: ApplicationStatus) => void;
  onEdit: () => void;
  onAddInterview: () => void;
  onToggleArchive: () => void;
  onDelete: () => void;
}

/** Company, role, the status control and the quick actions from SPEC section 6. */
export function DetailHeader({
  application,
  isStatusPending,
  isArchivePending,
  onStatusChange,
  onEdit,
  onAddInterview,
  onToggleArchive,
  onDelete,
}: DetailHeaderProps): JSX.Element {
  return (
    <header className="rounded-card border border-border bg-surface p-5">
      <div className="flex flex-wrap items-start gap-4">
        <span
          aria-hidden="true"
          className="grid h-12 w-12 shrink-0 place-items-center rounded-card bg-surface-muted text-base font-semibold text-content-muted"
        >
          {companyInitials(application.company)}
        </span>

        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold tracking-tight text-content">
            {application.company}
          </h1>
          <p className="text-sm text-content-muted">{application.role}</p>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <StatusSelect
              value={application.status}
              label="Application status"
              disabled={isStatusPending}
              onChange={onStatusChange}
            />

            <Badge className="bg-surface-muted text-content-muted">
              {EMPLOYMENT_TYPE_LABELS[application.employmentType]}
            </Badge>

            {application.workMode && (
              <Badge className="bg-surface-muted text-content-muted">
                {WORK_MODE_LABELS[application.workMode]}
              </Badge>
            )}

            {application.archived && <Badge className="bg-warning/15 text-warning">Archived</Badge>}

            {application.jobUrl && (
              <a
                href={application.jobUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
              >
                Job posting
                <ExternalLinkIcon className="h-3.5 w-3.5" />
              </a>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={onEdit}>
            <EditIcon className="h-4 w-4" />
            Edit
          </Button>
          <Button variant="secondary" size="sm" onClick={onAddInterview}>
            <PlusIcon className="h-4 w-4" />
            Interview
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={onToggleArchive}
            isLoading={isArchivePending}
            loadingLabel="Working"
          >
            <ArchiveIcon className="h-4 w-4" />
            {application.archived ? 'Unarchive' : 'Archive'}
          </Button>
          <Button variant="ghost" size="sm" aria-label="Delete application" onClick={onDelete}>
            <TrashIcon className="h-4 w-4 text-danger" />
          </Button>
        </div>
      </div>
    </header>
  );
}
