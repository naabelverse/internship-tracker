import { useDndMonitor } from '@dnd-kit/core';
import { useEffect, useState, type RefObject } from 'react';

/** How close to a list's top or bottom edge, in px, a held card starts it scrolling. */
const EDGE = 56;

/** Pixels per frame with the pointer at, or past, the edge. */
const MAX_STEP = 14;

interface ColumnScroller {
  start: (x: number, y: number) => void;
  stop: () => void;
}

/**
 * A frame loop that scrolls whichever column list the pointer is over when it
 * is within `EDGE` px of the list's top or bottom edge, faster the closer it is.
 * The band also reaches `EDGE` px past each edge, onto the header above and the
 * board's scrollbar below, so a card held just outside the list still scrolls it.
 */
function createColumnScroller(getBoard: () => HTMLElement | null): ColumnScroller {
  let pointer: { x: number; y: number } | null = null;
  let frame: number | null = null;

  function track(event: PointerEvent): void {
    pointer = { x: event.clientX, y: event.clientY };
  }

  function step(): void {
    const at = pointer;
    const lists = getBoard()?.querySelectorAll<HTMLElement>('[data-column-list]') ?? [];

    for (const list of at ? lists : []) {
      const box = list.getBoundingClientRect();
      if (!at || at.x < box.left || at.x > box.right) continue;

      const band = Math.min(EDGE, box.height / 3);
      const intoTop = box.top + band - at.y;
      const intoBottom = at.y - (box.bottom - band);

      if (intoTop > 0 && intoTop < band * 2) {
        list.scrollTop -= MAX_STEP * Math.min(1, intoTop / band);
      } else if (intoBottom > 0 && intoBottom < band * 2) {
        list.scrollTop += MAX_STEP * Math.min(1, intoBottom / band);
      }
      break;
    }

    frame = requestAnimationFrame(step);
  }

  function stop(): void {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    pointer = null;
    window.removeEventListener('pointermove', track);
  }

  function start(x: number, y: number): void {
    stop();
    pointer = { x, y };
    window.addEventListener('pointermove', track);
    frame = requestAnimationFrame(step);
  }

  return { start, stop };
}

/**
 * Scrolls a column's list while a card is dragged near its top or bottom edge.
 *
 * dnd-kit auto-scrolls only the scroll containers *around* the droppable being
 * hovered (`useScrollableAncestors(overNode)`), and a column's droppable is the
 * whole `<section>`, whose scrolling list is a child, not an ancestor. So from
 * `board-fit` up, where a column scrolls on its own, nothing would scroll it
 * mid-drag; on the old layout the window did, because columns never scrolled.
 *
 * Pointer drags only. A keyboard drag steps a whole column per arrow press and
 * a drop lands anywhere on the column, so it never needs to see further down.
 * In the normal flow below `board-fit` a list cannot scroll and this does nothing.
 */
export function useColumnAutoScroll(boardRef: RefObject<HTMLElement>): void {
  const [scroller] = useState(() => createColumnScroller(() => boardRef.current));

  useDndMonitor({
    onDragStart({ activatorEvent }) {
      // A PointerEvent is a MouseEvent; a keyboard drag's activator is not.
      if (activatorEvent instanceof MouseEvent) {
        scroller.start(activatorEvent.clientX, activatorEvent.clientY);
      }
    },
    onDragEnd: scroller.stop,
    onDragCancel: scroller.stop,
  });

  // A board unmounted mid-drag (the optimistic write can do that) must not leave
  // a frame loop or a listener behind.
  useEffect(() => scroller.stop, [scroller]);
}
