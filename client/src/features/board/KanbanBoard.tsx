import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
} from '@dnd-kit/core';
import { useRef } from 'react';
import { BoardColumn } from '@/features/board/BoardColumn';
import { BoardDragLayer } from '@/features/board/BoardDragLayer';
import { BoardJumpStrip } from '@/features/board/BoardJumpStrip';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { buildColumns } from '@/features/board/boardColumns';
import { boardKeyboardCoordinates } from '@/features/board/keyboardCoordinates';
import type { CardDragData } from '@/features/board/BoardCard';
import type { Application, ApplicationStatus } from '@/types/application';

interface KanbanBoardProps {
  applications: Application[];
  onOpen: (id: string) => void;
  /** Asks the page to move a card. The version is the one the card rendered with. */
  onMove: (id: string, status: ApplicationStatus, version?: number) => void;
}

/**
 * Pointer drags resolve by what is under the cursor, and only that: a release
 * outside every column is no drop, so the drag cancels as Escape does (issue
 * #97). Keyboard moves carry no pointer and resolve by centre.
 */
const collisionDetection: CollisionDetection = (args) =>
  args.pointerCoordinates ? pointerWithin(args) : closestCenter(args);

/**
 * The drag surface, and only the drag surface.
 *
 * It deliberately owns no mutation and no dialog. `BoardPage` renders this
 * subtree only while its query holds data, and the optimistic write plus its
 * rollback briefly leave that query with none, so the board is unmounted and
 * remounted mid-flight. Anything stateful living here dies with it: that is
 * exactly how the version-conflict dialog used to vanish while the user was
 * reading it, taking the pending drop with it and silently discarding the move.
 * The mutation lifecycle therefore lives one level up, above the boundary that
 * churns.
 *
 * A drop goes through `PATCH /applications/:id` rather than `/status` because
 * only the general update accepts `version`, and a drop has to carry the version
 * the card was rendered with. That endpoint still appends to `statusHistory`,
 * through the same `applyStatusChange` helper the status route uses.
 */
export function KanbanBoard({ applications, onOpen, onMove }: KanbanBoardProps): JSX.Element {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: boardKeyboardCoordinates }),
  );

  const boardRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');

  /** Brings a column to the board's left edge, or as far as the board scrolls. */
  function jumpTo(index: number): void {
    const board = boardRef.current;
    const column = board?.querySelector<HTMLElement>(`[data-column-index="${String(index)}"]`);
    if (!board || !column) return;

    // The board is `relative`, so a column's offsetLeft is measured from it.
    board.scrollTo({ left: column.offsetLeft, behavior: reduceMotion ? 'auto' : 'smooth' });
  }

  function onDragEnd({ active, over }: DragEndEvent): void {
    if (!over) return;

    const data = active.data.current as CardDragData | undefined;
    const destination = over.id as ApplicationStatus;

    // Dropping a card back where it started is not a change.
    if (!data || data.status === destination) return;

    onMove(String(active.id), destination, data.version);
  }

  const columns = buildColumns(applications);

  return (
    <DndContext sensors={sensors} collisionDetection={collisionDetection} onDragEnd={onDragEnd}>
      {/*
        SPEC section 6: at 375 px this scrolls sideways rather than squeezing.

        `relative` for the same reason the applications table needs it: `sr-only`
        is `position: absolute`, and `DeadlineChip` renders one inside every card,
        so without a positioned wrapper those boxes escape this scroll container
        and extend the document instead. See ApplicationsTable for the full note.

        From `board-fit` up it takes the height the page leaves it, so its
        sideways scrollbar is on screen and each column scrolls on its own;
        below that it is as tall as its longest column, as it always was.
      */}
      <div className="board-fit:flex board-fit:min-h-0 board-fit:flex-1 board-fit:flex-col">
        <BoardJumpStrip columns={columns} onJump={jumpTo} />

        <div
          ref={boardRef}
          className="relative flex gap-3 overflow-x-auto pb-2 board-fit:min-h-0 board-fit:flex-1 board-fit:scrollbar-themed"
          data-testid="kanban-board"
        >
          {columns.map((column) => (
            <BoardColumn key={column.status} column={column} onOpen={onOpen} />
          ))}
        </div>
      </div>

      <BoardDragLayer applications={applications} boardRef={boardRef} />
    </DndContext>
  );
}
