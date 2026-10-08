import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { PageHeader } from '@/components/ui/PageHeader';
import { Skeleton } from '@/components/ui/Skeleton';
import { VersionConflictDialog } from '@/features/applications/VersionConflictDialog';
import { useUpdateApplication } from '@/features/applications/useApplicationMutations';
import { KanbanBoard } from '@/features/board/KanbanBoard';
import { BOARD_LIMIT } from '@/features/board/boardColumns';
import { useBoardApplications } from '@/features/board/useBoardApplications';
import { paths } from '@/routes/paths';
import type { ApplicationStatus, VersionConflict } from '@/types/application';

function BoardSkeleton(): JSX.Element {
  return (
    <div className="relative flex gap-3 overflow-x-auto pb-2" data-testid="board-skeleton">
      {[0, 1, 2, 3, 4].map((column) => (
        <div key={column} className="w-72 shrink-0 space-y-2">
          <Skeleton className="h-8 w-full" label="Loading the board" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ))}
    </div>
  );
}

/** The move the user asked for, kept so a 409 can be retried as they meant it. */
interface PendingDrop {
  id: string;
  status: ApplicationStatus;
}

/**
 * The board route.
 *
 * The mutation, the conflict state, the pending drop and the conflict dialog all
 * live here rather than inside `KanbanBoard`, and that placement is load-bearing
 * rather than tidiness.
 *
 * The board subtree below only renders while this query holds data. An optimistic
 * write cancels every application query and its rollback restores them, which
 * leaves this one briefly with no data at all — `isPending` flips back to true and
 * the skeleton replaces the board. Anything owned by `KanbanBoard` is destroyed at
 * that moment. When that happened while a 409 prompt was open, the dialog vanished
 * before the user could answer it, and because `pendingDrop` died with the old
 * instance, "Overwrite with my changes" then did nothing at all — the prompt closed
 * and the drag was discarded with no error and no toast.
 *
 * Kept here, all of it outlives the churn: this component is mounted for the life
 * of the route, so nothing its own query does can unmount it. It also keeps the
 * `useUpdateApplication` observer alive for the whole request, which matters
 * because `onError` — the callback that raises the conflict — belongs to that
 * observer and would otherwise be gone before the 409 arrived.
 */
export function BoardPage(): JSX.Element {
  const navigate = useNavigate();
  const query = useBoardApplications();

  const [conflict, setConflict] = useState<VersionConflict | null>(null);
  const [pendingDrop, setPendingDrop] = useState<PendingDrop | null>(null);

  const update = useUpdateApplication(setConflict);

  const applications = query.data?.applications ?? [];
  const total = query.data?.meta.total ?? 0;

  function move(id: string, status: ApplicationStatus, version?: number): void {
    setPendingDrop({ id, status });

    update.mutate({
      id,
      payload: version === undefined ? { status } : { status, version },
      optimisticPatch: { status },
    });
  }

  function closePrompt(): void {
    setConflict(null);
    setPendingDrop(null);
  }

  return (
    // From `board-fit` up the shell gives this page a fixed height (AppLayout);
    // a column flex hands what the header leaves over to the board.
    <div className="space-y-5 board-fit:flex board-fit:min-h-0 board-fit:flex-1 board-fit:flex-col">
      <PageHeader
        title="Board"
        description="Drag a card by its Move bar to move it between columns."
      />

      {query.isPending && <BoardSkeleton />}

      {query.isError && (
        <ErrorState
          error={query.error}
          fallback="The board could not be loaded."
          onRetry={() => {
            void query.refetch();
          }}
          isRetrying={query.isFetching}
        />
      )}

      {query.isSuccess && applications.length === 0 && (
        <EmptyState
          title="Nothing on the board yet"
          message="Applications appear here as soon as you add them, sorted into a column per status."
        />
      )}

      {query.isSuccess && applications.length > 0 && (
        <>
          {total > BOARD_LIMIT && (
            <p role="status" className="text-sm text-content-muted">
              Showing the {BOARD_LIMIT} most recently updated of {total}. Use the table view to
              filter the rest.
            </p>
          )}

          <KanbanBoard
            applications={applications}
            onOpen={(id) => {
              void navigate(paths.applicationDetail(id));
            }}
            onMove={move}
          />
        </>
      )}

      {/*
        Outside every branch above on purpose. Nested inside one of them, this
        prompt would disappear the moment the query it sat under blinked.
      */}
      <VersionConflictDialog
        conflict={conflict}
        isPending={update.isPending}
        onDismiss={closePrompt}
        onReload={() => {
          // The optimistic patch is already rolled back, and `onSettled` has
          // refetched, so dropping the prompt leaves the server's truth on screen.
          closePrompt();
        }}
        onOverwrite={() => {
          const drop = pendingDrop;
          setConflict(null);
          // Resent without a version, which is what tells the server to stop
          // checking the read this started from.
          if (drop) move(drop.id, drop.status);
        }}
      />
    </div>
  );
}

/** Default export as well, so `React.lazy` can import this route. */
export default BoardPage;
