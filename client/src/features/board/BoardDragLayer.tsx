import { DragOverlay, useDndContext } from '@dnd-kit/core';
import type { RefObject } from 'react';
import { cardSurface } from '@/components/ui/Card';
import { BoardCardFace } from '@/features/board/BoardCard';
import { useColumnAutoScroll } from '@/features/board/useColumnAutoScroll';
import type { Application } from '@/types/application';

interface BoardDragLayerProps {
  applications: Application[];
  boardRef: RefObject<HTMLElement>;
}

/**
 * The card under the pointer during a drag, and the scrolling that follows it.
 *
 * The copy is drawn in dnd-kit's `DragOverlay`, which is fixed to the viewport,
 * because the card itself is clipped by its column's scrolling list as soon as
 * it leaves it: dragged sideways, a card used to vanish entirely, and once
 * columns scroll on their own it was cut off at the list's bottom edge too.
 * It looks as the moving card always did (`opacity-60` with a primary ring).
 *
 * `dropAnimation` is off so a drop lands at once, as it did before; collision
 * detection reads the pointer, so where a card lands is unchanged. The copy is
 * `aria-hidden`: the card it stands for keeps focus and the live announcements.
 */
export function BoardDragLayer({ applications, boardRef }: BoardDragLayerProps): JSX.Element {
  useColumnAutoScroll(boardRef);

  const { active } = useDndContext();
  const dragged = active ? applications.find((application) => application.id === active.id) : null;

  return (
    <DragOverlay dropAnimation={null}>
      {dragged ? (
        <div
          aria-hidden="true"
          data-drag-preview={dragged.id}
          className={`${cardSurface} p-3 opacity-60 ring-2 ring-primary`}
        >
          <BoardCardFace application={dragged} />
        </div>
      ) : null}
    </DragOverlay>
  );
}
