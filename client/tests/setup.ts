import '@testing-library/jest-dom/vitest';

/**
 * jsdom has no layout engine and no pointer events, both of which dnd-kit needs:
 * it measures droppables through ResizeObserver and getBoundingClientRect, and
 * its PointerSensor listens for pointer events. These shims give it the minimum
 * it needs; the synthetic geometry itself is opt-in per test, in tests/utils/dnd.
 */
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe(): void {
      // Nothing to observe: rects are supplied statically by the test.
    }
    unobserve(): void {
      /* no-op */
    }
    disconnect(): void {
      /* no-op */
    }
  };
}

if (typeof window.PointerEvent === 'undefined') {
  class PointerEventShim extends MouseEvent {
    readonly pointerId: number;
    readonly pointerType: string;
    readonly isPrimary: boolean;

    constructor(type: string, params: PointerEventInit = {}) {
      super(type, params);
      this.pointerId = params.pointerId ?? 1;
      this.pointerType = params.pointerType ?? 'mouse';
      this.isPrimary = params.isPrimary ?? true;
    }
  }

  window.PointerEvent = PointerEventShim as unknown as typeof PointerEvent;
}

if (typeof Element.prototype.setPointerCapture === 'undefined') {
  Element.prototype.setPointerCapture = function setPointerCapture(): void {
    /* no-op */
  };
  Element.prototype.releasePointerCapture = function releasePointerCapture(): void {
    /* no-op */
  };
  Element.prototype.hasPointerCapture = function hasPointerCapture(): boolean {
    return false;
  };
}
