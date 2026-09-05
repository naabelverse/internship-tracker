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
import { BoardColumn } from '@/features/board/BoardColumn';
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

/** Pointer drags resolve by what is under the cursor; keyboard moves by centre. */
const collisionDetection: CollisionDetection = (args) => {
  const underPointer = pointerWithin(args);
  return underPointer.length > 0 ? underPointer : closestCenter(args);
};

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
      */}
      <div className="relative flex gap-3 overflow-x-auto pb-2" data-testid="kanban-board">
        {columns.map((column) => (
          <BoardColumn key={column.status} column={column} onOpen={onOpen} />
        ))}
      </div>
    </DndContext>
  );
}
