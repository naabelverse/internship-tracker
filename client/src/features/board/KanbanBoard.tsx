import { useState } from 'react';
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
import { VersionConflictDialog } from '@/features/applications/VersionConflictDialog';
import { useUpdateApplication } from '@/features/applications/useApplicationMutations';
import type { Application, ApplicationStatus, VersionConflict } from '@/types/application';

interface KanbanBoardProps {
  applications: Application[];
  onOpen: (id: string) => void;
}

/** Pointer drags resolve by what is under the cursor; keyboard moves by centre. */
const collisionDetection: CollisionDetection = (args) => {
  const underPointer = pointerWithin(args);
  return underPointer.length > 0 ? underPointer : closestCenter(args);
};

interface PendingDrop {
  id: string;
  status: ApplicationStatus;
}

/**
 * The board reuses Phase 6's optimistic layer wholesale: a drop is a
 * `useUpdateApplication` call, so the snapshot, the rollback and the 409 handling
 * are the same code the edit modal runs.
 *
 * It goes through `PATCH /applications/:id` rather than `/status` because only
 * the general update accepts `version`, and a drop has to carry the version the
 * card was rendered with. That endpoint still appends to `statusHistory`, through
 * the same `applyStatusChange` helper the status route uses.
 */
export function KanbanBoard({ applications, onOpen }: KanbanBoardProps): JSX.Element {
  const [conflict, setConflict] = useState<VersionConflict | null>(null);
  const [pendingDrop, setPendingDrop] = useState<PendingDrop | null>(null);

  const update = useUpdateApplication(setConflict);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: boardKeyboardCoordinates }),
  );

  function move(id: string, status: ApplicationStatus, version?: number): void {
    setPendingDrop({ id, status });

    update.mutate({
      id,
      payload: version === undefined ? { status } : { status, version },
      optimisticPatch: { status },
    });
  }

  function onDragEnd({ active, over }: DragEndEvent): void {
    if (!over) return;

    const data = active.data.current as CardDragData | undefined;
    const destination = over.id as ApplicationStatus;

    // Dropping a card back where it started is not a change.
    if (!data || data.status === destination) return;

    move(String(active.id), destination, data.version);
  }

  const columns = buildColumns(applications);

  return (
    <>
      <DndContext sensors={sensors} collisionDetection={collisionDetection} onDragEnd={onDragEnd}>
        {/* SPEC section 6: at 375 px this scrolls sideways rather than squeezing. */}
        <div className="flex gap-3 overflow-x-auto pb-2" data-testid="kanban-board">
          {columns.map((column) => (
            <BoardColumn key={column.status} column={column} onOpen={onOpen} />
          ))}
        </div>
      </DndContext>

      <VersionConflictDialog
        conflict={conflict}
        isPending={update.isPending}
        onDismiss={() => {
          setConflict(null);
          setPendingDrop(null);
        }}
        onReload={() => {
          // The optimistic patch is already rolled back, and `onSettled` has
          // refetched, so dropping the prompt leaves the server's truth on screen.
          setConflict(null);
          setPendingDrop(null);
        }}
        onOverwrite={() => {
          const drop = pendingDrop;
          setConflict(null);
          if (drop) move(drop.id, drop.status);
        }}
      />
    </>
  );
}
