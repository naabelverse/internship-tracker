import { useDroppable } from '@dnd-kit/core';
import { StatusDot } from '@/components/ui/StatusDot';
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
      <header className="mb-2 flex shrink-0 items-center gap-2 px-1">
        <StatusDot status={column.status} />
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

      {/*
        From `board-fit` up the column has the board's height and this list
        scrolls under the header, which stays put. The list reaches 8 px into
        the column's right padding and keeps a stable 10 px gutter for the thin
        scrollbar, so every column's cards are the same width whether its list
        scrolls or not: 268 px, against 270 px in the page's normal flow.

        `relative` holds the `sr-only` text in each card's DeadlineChip. Those
        boxes are `position: absolute`; positioned against the board instead,
        they sat where an unscrolled list would put them, up to 2,300 px down,
        and gave the board a vertical scroll of its own.
      */}
      <ul
        data-column-list
        className="relative min-h-0 flex-1 space-y-2 overflow-y-auto board-fit:-mr-2 board-fit:scrollbar-themed board-fit:[scrollbar-gutter:stable]"
      >
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
