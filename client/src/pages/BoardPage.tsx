import { useNavigate } from 'react-router-dom';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { KanbanBoard } from '@/features/board/KanbanBoard';
import { BOARD_LIMIT } from '@/features/board/boardColumns';
import { useBoardApplications } from '@/features/board/useBoardApplications';
import { paths } from '@/routes/paths';

function BoardSkeleton(): JSX.Element {
  return (
    <div className="flex gap-3 overflow-x-auto pb-2" data-testid="board-skeleton">
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

export function BoardPage(): JSX.Element {
  const navigate = useNavigate();
  const query = useBoardApplications();

  const applications = query.data?.applications ?? [];
  const total = query.data?.meta.total ?? 0;

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-content">Board</h1>
        <p className="text-sm text-content-muted">
          Drag a card, or focus one and press space, to move it between columns.
        </p>
      </header>

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
          />
        </>
      )}
    </div>
  );
}
