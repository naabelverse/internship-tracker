import { fireEvent } from '@testing-library/react';

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
 * A pointer drag from a card's move handle to a column centre. dnd-kit's
 * PointerSensor listens on the owner document once the drag has started, so the
 * move and release are dispatched there rather than on the handle.
 */
export function pointerDrag(handle: HTMLElement, to: { clientX: number; clientY: number }): void {
  fireEvent.pointerDown(handle, { button: 0, clientX: 20, clientY: 60, pointerId: 1 });
  fireEvent.pointerMove(document, { clientX: 40, clientY: 80, pointerId: 1 });
  fireEvent.pointerMove(document, { ...to, pointerId: 1 });
  fireEvent.pointerUp(document, { ...to, pointerId: 1 });
}
