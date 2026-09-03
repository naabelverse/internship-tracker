import {
  KeyboardCode,
  type ClientRect,
  type DroppableContainer,
  type KeyboardCoordinateGetter,
} from '@dnd-kit/core';

interface ColumnTarget {
  container: DroppableContainer;
  index: number;
  rect: ClientRect;
}

/**
 * Moves a picked-up card one whole column per arrow press.
 *
 * dnd-kit's default keyboard getter nudges by 25 px, which on a board means a
 * dozen presses to cross a single column. Stepping through the declared column
 * order instead makes the keyboard path as direct as the pointer one, and it
 * depends on the column index rather than on how wide the columns happen to be.
 */
export const boardKeyboardCoordinates: KeyboardCoordinateGetter = (
  event,
  { currentCoordinates, context },
) => {
  const step = event.code === KeyboardCode.Right ? 1 : event.code === KeyboardCode.Left ? -1 : 0;

  if (step === 0) return;
  event.preventDefault();

  const columns = context.droppableContainers
    .getEnabled()
    .map((container) => ({
      container,
      index: typeof container.data.current?.index === 'number' ? container.data.current.index : -1,
      rect: context.droppableRects.get(container.id),
    }))
    .filter((entry): entry is ColumnTarget => entry.index >= 0 && entry.rect !== undefined)
    .sort((left, right) => left.index - right.index);

  const collisionRect = context.collisionRect;
  if (columns.length === 0 || !collisionRect) return;

  const centerX = collisionRect.left + collisionRect.width / 2;
  let from = columns.findIndex(
    (column) => centerX >= column.rect.left && centerX < column.rect.left + column.rect.width,
  );

  if (from === -1) {
    // Before the first move the card still sits in its origin column, which its
    // drag data names even if the geometry has not been measured yet.
    const origin = context.active?.data.current?.status;
    from = columns.findIndex((column) => column.container.id === origin);
  }

  if (from === -1) from = 0;

  const target = columns[from + step];
  if (!target) return;

  return {
    x: currentCoordinates.x + (target.rect.left - collisionRect.left),
    y: currentCoordinates.y,
  };
};
