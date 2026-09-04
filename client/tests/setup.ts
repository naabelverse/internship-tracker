import { configure } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

/**
 * Phase 13 made every route lazy, which is what keeps Chart.js, dnd-kit and the
 * markdown pair out of the landing bundle. Under Vite's on-demand transform the
 * first dynamic import in a file can take longer than the 1s default, so a
 * `findBy*` would time out on a page that is merely still compiling rather than
 * actually missing. The ceiling is raised, not removed: a genuinely absent
 * element still fails, just a few seconds later. It has to stay well under
 * `testTimeout` in vite.config.ts, or a slow query eats the whole test budget
 * and reports a timeout instead of the assertion that actually failed.
 */
configure({ asyncUtilTimeout: 10_000 });

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

/**
 * Chart.js asks the canvas for a 2D context and then draws through it. jsdom has
 * no canvas implementation, so `getContext` throws and every call after it would
 * fail on a null context — including the `update()` that a theme change goes
 * through, which is precisely the path the chart tests need to exercise.
 *
 * The proxy below answers any drawing call with a no-op and remembers whatever
 * is assigned to it, which is all Chart.js needs to run its layout, scale and
 * update passes headlessly. Nothing here fakes the chart's *configuration* —
 * the tests assert against the real Chart instance's own options and data.
 */
if (typeof HTMLCanvasElement.prototype.getContext === 'function') {
  const stubContext = function stubContext(this: HTMLCanvasElement): CanvasRenderingContext2D {
    const assigned = new Map<string, unknown>();
    const base: Record<string, unknown> = {
      canvas: this,
      measureText: (text: string) => ({ width: text.length * 6 }),
      getImageData: () => ({ data: new Uint8ClampedArray(4) }),
      createLinearGradient: () => ({ addColorStop: () => undefined }),
      getLineDash: () => [],
    };

    return new Proxy(base, {
      get: (target, key: string) =>
        key in target ? target[key] : (assigned.get(key) ?? (() => undefined)),
      set: (_target, key: string, value: unknown) => {
        assigned.set(key, value);
        return true;
      },
    }) as unknown as CanvasRenderingContext2D;
  };

  HTMLCanvasElement.prototype.getContext =
    stubContext as unknown as typeof HTMLCanvasElement.prototype.getContext;
}
