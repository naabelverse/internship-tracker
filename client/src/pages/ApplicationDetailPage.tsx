import { useCallback, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { ChevronLeftIcon } from '@/components/ui/icons';
import { ApplicationFormModal } from '@/features/applications/ApplicationFormModal';
import { ApplicationTimeline } from '@/features/applications/detail/ApplicationTimeline';
import { AttachmentsPanel } from '@/features/applications/detail/AttachmentsPanel';
import { DetailHeader } from '@/features/applications/detail/DetailHeader';
import { InterviewFormModal } from '@/features/applications/detail/InterviewFormModal';
import { NotesEditor } from '@/features/applications/detail/NotesEditor';
import { useApplicationQuery } from '@/features/applications/useApplicationQueries';
import {
  useChangeStatus,
  useDeleteApplication,
  useUpdateApplication,
} from '@/features/applications/useApplicationMutations';
import { formatDate, formatStipend } from '@/lib/formatters';
import { SOURCE_LABELS } from '@/lib/statusConfig';
import { paths } from '@/routes/paths';
import type { Application } from '@/types/application';

function DetailSkeleton(): JSX.Element {
  return (
    <div className="space-y-4" data-testid="detail-skeleton">
      <Skeleton className="h-28 w-full" label="Loading application" />
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-64 lg:col-span-2" />
        <Skeleton className="h-64" />
      </div>
    </div>
  );
}

function Facts({ application }: { application: Application }): JSX.Element {
  const rows: [string, string][] = [
    ['Location', application.location ?? '—'],
    ['Source', application.source ? SOURCE_LABELS[application.source] : '—'],
    ['Applied', formatDate(application.appliedDate)],
    ['Deadline', formatDate(application.deadline)],
    ['Stipend', formatStipend(application.stipend)],
    ['Resume', application.resumeVersion ?? '—'],
  ];

  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt className="text-content-subtle">{label}</dt>
          <dd className="text-content">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ApplicationDetailPage(): JSX.Element {
  const { applicationId = '' } = useParams<{ applicationId: string }>();
  const navigate = useNavigate();

  const query = useApplicationQuery(applicationId);
  const changeStatus = useChangeStatus();
  const update = useUpdateApplication();
  const remove = useDeleteApplication();

  const [isEditing, setIsEditing] = useState(false);
  const [isAddingInterview, setIsAddingInterview] = useState(false);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);

  const application = query.data;

  const saveNotes = useCallback(
    (notes: string) => {
      if (!application) return;

      update.mutate({
        id: application.id,
        payload: { notes },
        optimisticPatch: { notes },
      });
    },
    [application, update],
  );

  if (query.isPending) return <DetailSkeleton />;

  if (query.isError || !application) {
    return (
      <ErrorState
        error={query.error}
        fallback="That application could not be loaded."
        onRetry={() => {
          void query.refetch();
        }}
        isRetrying={query.isFetching}
      />
    );
  }

  return (
    <div className="space-y-5">
      <Link
        to={paths.applications}
        className="inline-flex items-center gap-1 text-sm text-content-muted hover:text-content"
      >
        <ChevronLeftIcon className="h-4 w-4" />
        All applications
      </Link>

      <DetailHeader
        application={application}
        isStatusPending={changeStatus.isPending}
        isArchivePending={update.isPending}
        onStatusChange={(status) => {
          changeStatus.mutate({ id: application.id, status });
        }}
        onEdit={() => {
          setIsEditing(true);
        }}
        onAddInterview={() => {
          setIsAddingInterview(true);
        }}
        onToggleArchive={() => {
          update.mutate({
            id: application.id,
            payload: { archived: !application.archived },
            optimisticPatch: { archived: !application.archived },
          });
        }}
        onDelete={() => {
          setIsConfirmingDelete(true);
        }}
      />

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <NotesEditor
            savedNotes={application.notes ?? ''}
            isSaving={update.isPending}
            onSave={saveNotes}
          />
          <AttachmentsPanel application={application} />
        </div>

        <div className="space-y-5">
          <section
            aria-labelledby="facts-heading"
            className="rounded-card border border-border bg-surface p-4"
          >
            <h2 id="facts-heading" className="mb-3 text-sm font-semibold text-content">
              Details
            </h2>
            <Facts application={application} />
          </section>

          <section
            aria-labelledby="timeline-heading"
            className="rounded-card border border-border bg-surface p-4"
          >
            <h2 id="timeline-heading" className="mb-4 text-sm font-semibold text-content">
              Timeline
            </h2>
            <ApplicationTimeline application={application} />
          </section>
        </div>
      </div>

      <ApplicationFormModal
        isOpen={isEditing}
        application={application}
        onClose={() => {
          setIsEditing(false);
        }}
      />

      <InterviewFormModal
        isOpen={isAddingInterview}
        applicationId={application.id}
        onClose={() => {
          setIsAddingInterview(false);
        }}
      />

      <ConfirmDialog
        isOpen={isConfirmingDelete}
        title={`Delete ${application.company}?`}
        message="This removes the application along with its interviews, notes and attachments. It cannot be undone."
        confirmLabel="Delete it"
        isPending={remove.isPending}
        onCancel={() => {
          setIsConfirmingDelete(false);
        }}
        onConfirm={() => {
          setIsConfirmingDelete(false);
          remove.mutate(application.id, {
            onSuccess: () => {
              void navigate(paths.applications, { replace: true });
            },
          });
        }}
      />
    </div>
  );
}
