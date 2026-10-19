import { useCallback, useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { PageHeader } from '@/components/ui/PageHeader';
import { Skeleton } from '@/components/ui/Skeleton';
import { ApplicationCardList } from '@/features/applications/ApplicationCardList';
import { ApplicationFormModal } from '@/features/applications/ApplicationFormModal';
import { ApplicationsTable } from '@/features/applications/ApplicationsTable';
import { ApplicationsToolbar } from '@/features/applications/ApplicationsToolbar';
import { BulkActionsBar } from '@/features/applications/BulkActionsBar';
import { PaginationBar } from '@/features/applications/PaginationBar';
import {
  COLUMN_STORAGE_KEY,
  DEFAULT_HIDDEN_COLUMNS,
  isColumnIdList,
  visibleColumns,
} from '@/features/applications/columns';
import { hasActiveFilters } from '@/features/applications/filterParams';
import { useApplicationFilters } from '@/features/applications/useApplicationFilters';
import { useApplicationsQuery } from '@/features/applications/useApplicationQueries';
import { useBulkAction, useChangeStatus } from '@/features/applications/useApplicationMutations';
import { useLocalStorageState } from '@/hooks/useLocalStorageState';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import type { Application, ApplicationStatus } from '@/types/application';

function TableSkeleton(): JSX.Element {
  return (
    <div className="space-y-3" data-testid="applications-skeleton">
      <Skeleton className="h-10 w-full" label="Loading applications" />
      {[0, 1, 2, 3, 4, 5].map((row) => (
        <Skeleton key={row} className="h-14 w-full" />
      ))}
    </div>
  );
}

export function ApplicationsPage(): JSX.Element {
  const { filters, setFilters, clearFilters } = useApplicationFilters();
  const query = useApplicationsQuery(filters);
  const changeStatus = useChangeStatus();
  const bulk = useBulkAction();

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isCreating, setIsCreating] = useState(false);

  /**
   * The row being edited is held as a snapshot taken when Edit was clicked, not
   * re-derived from the live list on every render.
   *
   * Deriving it made the modal's own existence depend on a value an unrelated
   * refetch could take away: an optimistic delete, a page or filter change, or a
   * refetch that simply no longer contained the row all made `find` return
   * undefined, which closed the modal mid-edit, wiped the in-progress form when
   * the row came back, and left `isEdit` false so saving POSTed a duplicate
   * instead of updating.
   *
   * The snapshot is also the more correct value. `version` has to be the one the
   * user read, because that is what the server compares against; re-deriving
   * silently advanced it on every background refetch and quietly disarmed the
   * conflict check the dialog exists to handle.
   */
  const [editing, setEditing] = useState<Application | null>(null);

  const [hiddenColumns, setHiddenColumns] = useLocalStorageState<string[]>(
    COLUMN_STORAGE_KEY,
    DEFAULT_HIDDEN_COLUMNS,
    isColumnIdList,
  );

  const isNarrow = useMediaQuery('(max-width: 767px)');
  const columns = useMemo(() => visibleColumns(hiddenColumns), [hiddenColumns]);
  // Memoised so `toggleAll` keeps a stable identity between renders.
  const applications = useMemo(() => query.data?.applications ?? [], [query.data]);

  // Resolved once, from the list the user is actually looking at, and then held.
  const startEditing = useCallback(
    (id: string) => {
      const row = applications.find((application) => application.id === id);
      if (row) setEditing(row);
    },
    [applications],
  );

  const toggle = useCallback((id: string) => {
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id],
    );
  }, []);

  const toggleAll = useCallback(() => {
    setSelectedIds((current) =>
      current.length === applications.length ? [] : applications.map((entry) => entry.id),
    );
  }, [applications]);

  const onSort = useCallback(
    (field: string) => {
      const [currentField, currentDirection] = filters.sort.split(':');
      const direction = currentField === field && currentDirection === 'asc' ? 'desc' : 'asc';
      setFilters({ sort: `${field}:${direction}` });
    },
    [filters.sort, setFilters],
  );

  const runBulk = useCallback(
    (action: 'delete' | 'archive' | 'unarchive' | 'setStatus', status?: ApplicationStatus) => {
      const ids = selectedIds;
      setSelectedIds([]);
      bulk.mutate({ ids, action, status });
    },
    [bulk, selectedIds],
  );

  const pendingStatusIds =
    changeStatus.isPending && changeStatus.variables ? [changeStatus.variables.id] : [];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Applications"
        description={
          query.data ? `${String(query.data.meta.total)} tracked` : 'Loading your applications'
        }
      />

      <ApplicationsToolbar
        filters={filters}
        total={query.data?.meta.total}
        hiddenColumns={hiddenColumns}
        onFiltersChange={setFilters}
        onClearFilters={clearFilters}
        onHiddenColumnsChange={setHiddenColumns}
        onCreate={() => {
          setIsCreating(true);
        }}
      />

      <BulkActionsBar
        selectedIds={selectedIds}
        isPending={bulk.isPending}
        onClear={() => {
          setSelectedIds([]);
        }}
        onArchive={() => {
          runBulk('archive');
        }}
        onUnarchive={() => {
          runBulk('unarchive');
        }}
        onDelete={() => {
          runBulk('delete');
        }}
        onSetStatus={(status) => {
          runBulk('setStatus', status);
        }}
      />

      {query.isPending && <TableSkeleton />}

      {query.isError && (
        <ErrorState
          error={query.error}
          fallback="The applications list could not be loaded."
          onRetry={() => {
            void query.refetch();
          }}
          isRetrying={query.isFetching}
        />
      )}

      {query.isSuccess && applications.length === 0 && (
        <EmptyState
          title={
            hasActiveFilters(filters) ? 'Nothing matches those filters' : 'No applications yet'
          }
          message={
            hasActiveFilters(filters)
              ? 'Try widening the search, or clear the filters to see everything again.'
              : 'Add the first role you are chasing and it will show up here.'
          }
          action={
            hasActiveFilters(filters) ? (
              <Button variant="secondary" onClick={clearFilters}>
                Clear filters
              </Button>
            ) : (
              <Button
                onClick={() => {
                  setIsCreating(true);
                }}
              >
                Add an application
              </Button>
            )
          }
        />
      )}

      {query.isSuccess && applications.length > 0 && (
        <>
          {isNarrow ? (
            <ApplicationCardList
              applications={applications}
              selectedIds={selectedIds}
              pendingStatusIds={pendingStatusIds}
              onToggle={toggle}
              onEdit={startEditing}
              onStatusChange={(id, status) => {
                changeStatus.mutate({ id, status });
              }}
            />
          ) : (
            <ApplicationsTable
              applications={applications}
              columns={columns}
              selectedIds={selectedIds}
              sort={filters.sort}
              pendingStatusIds={pendingStatusIds}
              onToggle={toggle}
              onToggleAll={toggleAll}
              onSort={onSort}
              onEdit={startEditing}
              onStatusChange={(id, status) => {
                changeStatus.mutate({ id, status });
              }}
            />
          )}

          <PaginationBar
            meta={query.data.meta}
            onPageChange={(page) => {
              setFilters({ page });
            }}
          />
        </>
      )}

      <ApplicationFormModal
        isOpen={isCreating}
        onClose={() => {
          setIsCreating(false);
        }}
      />

      <ApplicationFormModal
        isOpen={editing !== null}
        application={editing ?? undefined}
        onClose={() => {
          setEditing(null);
        }}
      />
    </div>
  );
}

/** Default export as well, so `React.lazy` can import this route. */
export default ApplicationsPage;
