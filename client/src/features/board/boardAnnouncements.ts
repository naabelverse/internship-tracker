import type { Active, Announcements, Over, ScreenReaderInstructions } from '@dnd-kit/core';
import type { CardDragData } from '@/features/board/BoardCard';
import { STATUS_CONFIG } from '@/lib/statusConfig';
import type { ApplicationStatus } from '@/types/application';

/**
 * What a screen reader hears during a board drag (issue #90).
 *
 * dnd-kit's defaults name the draggable and droppable by `id`, which here are
 * the application's database id and the raw status key: "Draggable item
 * 6ac648aa… was moved over droppable area withdrawn." These name the company
 * and the column as the board shows them instead.
 */

function company(active: Active): string {
  return (active.data.current as CardDragData | undefined)?.company ?? 'The application';
}

function from(active: Active): string {
  const status = (active.data.current as CardDragData | undefined)?.status;
  return status ? STATUS_CONFIG[status].label : 'its column';
}

function column(over: Over): string {
  return STATUS_CONFIG[over.id as ApplicationStatus].label;
}

/**
 * One set per board. dnd-kit reports the card's own column as the first "over"
 * right after pick-up, which would replace "Picked up Shopee, in Saved." in the
 * live region before it is read; that first report is skipped. Moving back to
 * the starting column later is still announced.
 */
export function createBoardAnnouncements(): Announcements {
  let pickedUp = false;

  return {
    onDragStart: ({ active }) => {
      pickedUp = true;
      return `Picked up ${company(active)}, in ${from(active)}.`;
    },
    onDragOver: ({ active, over }) => {
      const first = pickedUp;
      pickedUp = false;
      if (first && over?.id === (active.data.current as CardDragData | undefined)?.status) {
        return undefined;
      }
      return over
        ? `${company(active)} is over ${column(over)}.`
        : `${company(active)} is not over a column.`;
    },
    onDragEnd: ({ active, over }) =>
      over
        ? `${company(active)} dropped in ${column(over)}.`
        : `${company(active)} dropped outside the columns. It stays in ${from(active)}.`,
    onDragCancel: ({ active }) => `Move cancelled. ${company(active)} is back in ${from(active)}.`,
  };
}

export const boardInstructions: ScreenReaderInstructions = {
  draggable:
    'To move this application, press Space or Enter. Use the left and right arrow keys to choose a column, then press Space or Enter to drop it there, or Escape to cancel.',
};
