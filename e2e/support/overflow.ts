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

/**
 * Names the element actually responsible for the document's width, by removing
 * candidates one at a time and re-measuring.
 *
 * The rect scan above is a heuristic and it has blind spots: it cannot see a
 * pseudo-element, a margin (which `getBoundingClientRect` excludes but scrollable
 * overflow includes), or an absolutely-positioned box that escapes an ancestor
 * whose `overflow` neither clips nor contains it. When the document overflows and
 * the scan reports nothing, that is exactly the situation, and guessing from the
 * markup is how the Phase 9 investigation went wrong the first time.
 *
 * This asks the browser instead. It walks down from `body`, and at each level
 * hides one child at a time: if `documentElement.scrollWidth` drops back to
 * `clientWidth`, that subtree owns the overflow, and it descends into it. What
 * comes back is the narrowest element whose removal fixes the document — the
 * actual culprit, not a candidate.
 */
export async function bisectOverflow(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const target = doc.clientWidth;
    const trail: string[] = [];

    const describe = (element: Element): string => {
      const id = element.id ? `#${element.id}` : '';
      const classes = element.className.toString().trim().split(/\s+/).slice(0, 4).join('.');
      const testId = element.getAttribute('data-testid');

      return (
        `${element.tagName.toLowerCase()}${id}` +
        `${classes ? `.${classes}` : ''}` +
        `${testId ? ` [data-testid=${testId}]` : ''}`
      );
    };

    /** Hides `element`, measures, restores. */
    const widthWithout = (element: HTMLElement): number => {
      const previous = element.style.display;
      element.style.setProperty('display', 'none', 'important');
      const width = doc.scrollWidth;
      element.style.display = previous;

      return width;
    };

    let current: Element = document.body;

    for (let depth = 0; depth < 30; depth += 1) {
      let culprit: HTMLElement | null = null;

      for (const child of current.children) {
        if (!(child instanceof HTMLElement)) continue;
        if (widthWithout(child) <= target) {
          culprit = child;
          break;
        }
      }

      // No single child accounts for it: the overflow belongs to this element
      // itself — its own box, padding, margin or a pseudo-element — rather than
      // to anything inside it. That is the answer, so stop here.
      if (!culprit) break;

      trail.push(describe(culprit));
      current = culprit;
    }

    return trail;
  });
}

/**
 * The containment story for one element and every ancestor above it.
 *
 * When bisection names a box inside what looks like a scroll container, the
 * question is which ancestor was supposed to contain it and did not. This prints
 * the numbers that answer it — computed overflow on both axes, and the
 * client/scroll/offset widths — rather than leaving it to be reasoned out from
 * the markup.
 */
export async function containmentChain(page: Page, culpritSuffix: string): Promise<string[]> {
  return page.evaluate((suffix) => {
    const describe = (element: Element): string => {
      const classes = element.className.toString().trim().split(/\s+/).slice(0, 3).join('.');
      return `${element.tagName.toLowerCase()}${classes ? `.${classes}` : ''}`;
    };

    const matches = [...document.querySelectorAll('*')].filter((element) =>
      describe(element).startsWith(suffix),
    );
    const start = matches[matches.length - 1];
    if (!start) return [`no element matching ${suffix}`];

    const rows: string[] = [];
    let current: Element | null = start;

    while (current) {
      const style = getComputedStyle(current);
      const rect = current.getBoundingClientRect();
      rows.push(
        `${describe(current).padEnd(46)} ` +
          `overflow=${style.overflowX}/${style.overflowY} ` +
          `client=${String(current.clientWidth)} scroll=${String(current.scrollWidth)} ` +
          `rect=${rect.width.toFixed(1)} display=${style.display}`,
      );
      current = current.parentElement;
    }

    return rows;
  }, culpritSuffix);
}
