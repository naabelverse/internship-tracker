import type { Page } from '@playwright/test';

export interface OverflowNode {
  tag: string;
  classes: string;
  testId: string | null;
  right: number;
  left: number;
  width: number;
  position: string;
  overflowX: string;
  transform: string;
  /** The ancestor chain, so an out-of-flow box can be traced to its container. */
  path: string;
}

export interface OverflowReport {
  /** The document's own scroller. Document scrolling lives here, not on `body`. */
  docScrollWidth: number;
  docClientWidth: number;
  bodyScrollWidth: number;
  bodyClientWidth: number;
  innerWidth: number;
  /** Whether the document *actually* scrolled, not whether it looked like it would. */
  scrolledBy: number;
  offenders: OverflowNode[];
}

/**
 * Measures horizontal overflow the way the browser experiences it.
 *
 * Phase 9 reported the board route scrolling sideways while `body.scrollWidth`
 * equalled the viewport, and could not isolate it. That pairing is the clue:
 * `body` is not the document's scrolling element, so measuring it answers a
 * different question from the one being asked. This records both, and then
 * settles it by actually scrolling.
 */
export async function measureOverflow(page: Page): Promise<OverflowReport> {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const limit = doc.clientWidth;

    const describe = (element: Element): string => {
      const parts: string[] = [];
      let current: Element | null = element;

      for (let depth = 0; current && depth < 6; depth += 1) {
        const id = current.id ? `#${current.id}` : '';
        const first = current.className.toString().trim().split(/\s+/)[0] ?? '';
        parts.unshift(`${current.tagName.toLowerCase()}${id}${first ? `.${first}` : ''}`);
        current = current.parentElement;
      }

      return parts.join(' > ');
    };

    /**
     * True when some ancestor already scrolls or clips this box horizontally.
     *
     * A card inside the board's `overflow-x: auto` strip has a viewport-relative
     * rect reaching well past the viewport — that is what correct internal
     * scrolling *looks like*, not a fault. Counting those reports the board as
     * overflowing at every width and the applications table at exactly the width
     * where it stops fitting, which is the pattern Phase 9 recorded and then
     * attributed to the document.
     */
    const isContained = (element: Element): boolean => {
      let current = element.parentElement;

      while (current && current !== document.body) {
        const overflowX = getComputedStyle(current).overflowX;
        if (overflowX !== 'visible') return true;
        current = current.parentElement;
      }

      return false;
    };

    const offenders = [...document.querySelectorAll('*')]
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);

        return {
          element,
          tag: element.tagName.toLowerCase(),
          classes: element.className.toString().slice(0, 160),
          testId: element.getAttribute('data-testid'),
          right: Math.round(rect.right),
          left: Math.round(rect.left),
          width: Math.round(rect.width),
          position: style.position,
          overflowX: style.overflowX,
          transform: style.transform === 'none' ? 'none' : style.transform,
          path: describe(element),
        };
      })
      // Only boxes that can actually create scrollable overflow to the right.
      //
      // Two exclusions, both load-bearing rather than tidying. A `position:
      // fixed` box is laid out against the viewport and contributes nothing to
      // the initial containing block's scrollable overflow, so the off-canvas
      // navigation drawer sitting at `left: -256px` is not an offender however
      // far outside the viewport it looks — and a detector that counts it
      // reports every route as overflowing at every width below `lg`, which is
      // very close to what Phase 9 described. And overflow to the *left* does
      // not extend the scrollable area in a left-to-right document at all.
      //
      // 1 px of slack, because a sub-pixel rounding artefact is not an overflow.
      .filter(
        (node) => node.position !== 'fixed' && node.right > limit + 1 && !isContained(node.element),
      )
      .map(({ element: _element, ...node }) => node);

    const scroller = document.scrollingElement ?? doc;
    const startedAt = scroller.scrollLeft;
    scroller.scrollLeft = 9999;
    const scrolledBy = scroller.scrollLeft - startedAt;
    scroller.scrollLeft = startedAt;

    return {
      docScrollWidth: doc.scrollWidth,
      docClientWidth: doc.clientWidth,
      bodyScrollWidth: document.body.scrollWidth,
      bodyClientWidth: document.body.clientWidth,
      innerWidth: window.innerWidth,
      scrolledBy,
      offenders,
    };
  });
}

/**
 * Hides one offender and re-measures, which is what turns a list of suspects
 * into a cause. Restores the element afterwards, so a probe cannot change the
 * result of the next one.
 */
export async function overflowWithout(page: Page, path: string): Promise<number> {
  return page.evaluate((wanted) => {
    const doc = document.documentElement;

    const describe = (element: Element): string => {
      const parts: string[] = [];
      let current: Element | null = element;

      for (let depth = 0; current && depth < 6; depth += 1) {
        const id = current.id ? `#${current.id}` : '';
        const first = current.className.toString().trim().split(/\s+/)[0] ?? '';
        parts.unshift(`${current.tagName.toLowerCase()}${id}${first ? `.${first}` : ''}`);
        current = current.parentElement;
      }

      return parts.join(' > ');
    };

    const target = [...document.querySelectorAll('*')].find(
      (element) => describe(element) === wanted,
    );
    if (!(target instanceof HTMLElement)) return doc.scrollWidth;

    const previous = target.style.visibility;
    const previousDisplay = target.style.display;
    target.style.display = 'none';
    const width = doc.scrollWidth;
    target.style.display = previousDisplay;
    target.style.visibility = previous;

    return width;
  }, path);
}
