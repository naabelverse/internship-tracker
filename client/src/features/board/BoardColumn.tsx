import { useDroppable } from '@dnd-kit/core';
import { BoardCard } from '@/features/board/BoardCard';
import type { BoardColumnModel } from '@/features/board/boardColumns';
import { STATUS_CONFIG } from '@/lib/statusConfig';
import { cn } from '@/lib/cn';

interface BoardColumnProps {
  column: BoardColumnModel;
  onOpen: (id: string) => void;
}

export function BoardColumn({ column, onOpen }: BoardColumnProps): JSX.Element {
  const { setNodeRef, isOver } = useDroppable({
    id: column.status,
    data: { index: column.index },
  });

  return (
    <section
      ref={setNodeRef}
      data-column-index={column.index}
      data-testid={`column-${column.status}`}
      aria-label={`${column.label}, ${String(column.applications.length)} applications`}
      className={cn(
        'flex w-72 shrink-0 flex-col rounded-card border bg-surface-muted/40 p-2 transition-colors',
        isOver ? 'border-primary bg-primary/5' : 'border-border',
      )}
    >
      <header className="mb-2 flex items-center gap-2 px-1">
        <span
          aria-hidden="true"
          className={cn('h-2 w-2 rounded-full', STATUS_CONFIG[column.status].dot)}
        />
        <h2 className="panel-title">{column.label}</h2>
        <span
          className={cn(
            'ml-auto rounded-full px-2 py-0.5 text-xs font-medium',
            STATUS_CONFIG[column.status].pill,
          )}
        >
          {column.applications.length}
        </span>
      </header>

      <ul className="flex-1 space-y-2 overflow-y-auto">
        {column.applications.map((application, cardIndex) => (
          <BoardCard
            key={application.id}
            application={application}
            cardIndex={cardIndex}
            onOpen={onOpen}
          />
        ))}

        {column.applications.length === 0 && (
          <li className="rounded-control border border-dashed border-border px-3 py-6 text-center text-xs text-content-subtle">
            Nothing here
          </li>
        )}
      </ul>
    </section>
  );
}
