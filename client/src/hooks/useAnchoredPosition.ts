import { useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';

/** The page's side gutter, which a floating panel never crosses. */
const GUTTER_PX = 16;

/**
 * Fixed-position coordinates that float `panelRef` under `anchorRef`, so an
 * ancestor that scrolls or clips — a modal's body — cannot cut the panel off.
 * It flips above the anchor when only that side has room, stays inside the
 * viewport's gutter, and follows the anchor through any scroll or resize.
 * `gapPx` is the space between anchor and panel: the select panel's `my-1` by
 * default. `undefined` while inactive.
 */
export function useAnchoredPosition(
  anchorRef: RefObject<HTMLElement> | undefined,
  panelRef: RefObject<HTMLElement>,
  active: boolean,
  align: 'left' | 'right',
  gapPx = 4,
): CSSProperties | undefined {
  const [position, setPosition] = useState<CSSProperties>();
  const placeRef = useRef<() => void>();

  useLayoutEffect(() => {
    if (!active || !anchorRef) {
      placeRef.current = undefined;
      setPosition(undefined);
      return;
    }

    const place = (): void => {
      const anchor = anchorRef.current;
      const panel = panelRef.current;
      if (!anchor || !panel) return;

      const rect = anchor.getBoundingClientRect();
      const height = panel.offsetHeight;
      const width = panel.offsetWidth;

      const below = rect.bottom + gapPx;
      const above = rect.top - gapPx - height;
      const fitsBelow = below + height <= window.innerHeight - GUTTER_PX;
      const top = !fitsBelow && above >= GUTTER_PX ? above : below;

      // The root's own width, not `innerWidth` or `clientWidth`: with the
      // scrollbar gutter reserved (`index.css`), both of those count it, and
      // the page's gutter is measured from where the page ends.
      const viewportWidth = document.documentElement.getBoundingClientRect().width;
      const preferred = align === 'right' ? rect.right - width : rect.left;
      const left = Math.max(GUTTER_PX, Math.min(preferred, viewportWidth - GUTTER_PX - width));

      // Same coordinates, same object: the re-render pass below runs after
      // every render, and a fresh object each time would never settle.
      setPosition((current) =>
        current?.top === top && current.left === left ? current : { top, left },
      );
    };

    placeRef.current = place;
    place();
    window.addEventListener('resize', place);
    // Capture, because the scroll that moves the anchor is usually a modal
    // body's, and scroll events do not bubble.
    window.addEventListener('scroll', place, true);

    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [active, anchorRef, panelRef, align, gapPx]);

  // A re-render can move the anchor with no scroll or resize, such as a count
  // badge appearing in a toolbar that then re-flows, so place again after each.
  useLayoutEffect(() => {
    placeRef.current?.();
  });

  return position;
}
