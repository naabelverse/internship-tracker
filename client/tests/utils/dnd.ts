import { fireEvent, waitFor } from '@testing-library/react';

const COLUMN_WIDTH = 320;
const COLUMN_HEIGHT = 600;
const CARD_WIDTH = 300;
const CARD_HEIGHT = 80;
const CARD_GAP = 90;

function rect(x: number, y: number, width: number, height: number): DOMRect {
  return {
    x,
    y,
    width,
    height,
    top: y,
    left: x,
    right: x + width,
    bottom: y + height,
    toJSON: () => ({}),
  } as DOMRect;
}

/**
 * Gives the board a synthetic layout.
 *
 * jsdom reports every element as a zero-sized box at the origin, so dnd-kit's
 * collision detection has nothing to resolve a drop against. Columns are laid out
 * left to right by their `data-column-index` and cards stacked inside them by
 * `data-card-index`, which is the geometry a real browser would produce. Restoring
 * the original method is the caller's job, through the returned function.
 */
export function mockBoardLayout(): () => void {
  const original = Element.prototype.getBoundingClientRect;

  Element.prototype.getBoundingClientRect = function measured(this: Element): DOMRect {
    const columnAttribute = this.getAttribute('data-column-index');
    if (columnAttribute !== null) {
      return rect(Number(columnAttribute) * COLUMN_WIDTH, 0, COLUMN_WIDTH, COLUMN_HEIGHT);
    }

    const cardAttribute = this.getAttribute('data-card-index');
    if (cardAttribute !== null) {
      const column = this.closest('[data-column-index]');
      const columnIndex = Number(column?.getAttribute('data-column-index') ?? 0);

      return rect(
        columnIndex * COLUMN_WIDTH + 10,
        40 + Number(cardAttribute) * CARD_GAP,
        CARD_WIDTH,
        CARD_HEIGHT,
      );
    }

    return rect(0, 0, 0, 0);
  };

  return () => {
    Element.prototype.getBoundingClientRect = original;
  };
}

/** The centre of a column, in the coordinate space `mockBoardLayout` defines. */
export function columnCentre(index: number): { clientX: number; clientY: number } {
  return {
    clientX: index * COLUMN_WIDTH + COLUMN_WIDTH / 2,
    clientY: COLUMN_HEIGHT / 2,
  };
}

/**
 * Whether dnd-kit is still swallowing clicks after a drag.
 *
 * `AbstractPointerSensor.handleStart` adds a capture-phase `click` listener on
 * the document that calls `stopPropagation`, so the click a pointer device emits
 * at the end of a drag cannot also activate whatever sits under the cursor. It is
 * removed on a `setTimeout(..., 50)` scheduled in `detach()`, so it outlives the
 * release by 50 ms of *real* time — during which no click reaches its target or
 * React at all.
 *
 * The probe is a non-bubbling click dispatched at `<html>`, whose entire event path
 * is therefore `document` then `<html>`: off the path of both React roots, which
 * live inside `<body>`, so nothing in the tree under test can observe it. A
 * suppressed click is stopped at the document during the capture phase and never
 * reaches the target phase.
 *
 * It deliberately mutates nothing. `waitFor` re-runs its callback from a
 * MutationObserver, whose callbacks are microtasks, so a probe that touched the DOM
 * would re-arm itself faster than the event loop could ever reach the 50 ms timer
 * it is waiting on, and the wait would never end.
 */
function clickIsSuppressed(): boolean {
  const root = document.documentElement;

  let delivered = false;
  const record = (): void => {
    delivered = true;
  };

  root.addEventListener('click', record);
  root.dispatchEvent(new MouseEvent('click'));
  root.removeEventListener('click', record);

  return !delivered;
}

/**
 * A pointer drag from a card's move handle to a column centre. dnd-kit's
 * PointerSensor listens on the owner document once the drag has started, so the
 * move and release are dispatched there rather than on the handle.
 *
 * Resolves once dnd-kit has finished tearing the drag down, which is later than
 * the release: see `clickIsSuppressed`. A hand needs longer than 50 ms to reach a
 * button after letting go of a card, so only a test can be fast enough to be bitten
 * by this — and it is bitten silently, with the click landing on a live, enabled,
 * correctly labelled node and no handler running.
 */
export async function pointerDrag(
  handle: HTMLElement,
  to: { clientX: number; clientY: number },
): Promise<void> {
  fireEvent.pointerDown(handle, { button: 0, clientX: 20, clientY: 60, pointerId: 1 });
  fireEvent.pointerMove(document, { clientX: 40, clientY: 80, pointerId: 1 });
  fireEvent.pointerMove(document, { ...to, pointerId: 1 });
  fireEvent.pointerUp(document, { ...to, pointerId: 1 });

  await waitFor(() => {
    if (clickIsSuppressed()) {
      throw new Error('dnd-kit is still suppressing clicks after the drag');
    }
  });
}
