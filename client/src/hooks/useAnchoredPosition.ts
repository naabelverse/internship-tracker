import { useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react';

/** The select panel's `my-1` gap between a field and what opens from it. */
const GAP_PX = 4;
/** The page's side gutter, which a floating panel never crosses. */
const GUTTER_PX = 16;

/**
 * Fixed-position coordinates that float `panelRef` under `anchorRef`, so an
 * ancestor that scrolls or clips — a modal's body — cannot cut the panel off.
 * It flips above the anchor when only that side has room, stays inside the
 * viewport's gutter, and follows the anchor through any scroll or resize.
 * `undefined` while inactive.
 */
export function useAnchoredPosition(
  anchorRef: RefObject<HTMLElement> | undefined,
  panelRef: RefObject<HTMLElement>,
  active: boolean,
  align: 'left' | 'right',
): CSSProperties | undefined {
  const [position, setPosition] = useState<CSSProperties>();

  useLayoutEffect(() => {
    if (!active || !anchorRef) {
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

      const below = rect.bottom + GAP_PX;
      const above = rect.top - GAP_PX - height;
      const fitsBelow = below + height <= window.innerHeight - GUTTER_PX;
      const top = !fitsBelow && above >= GUTTER_PX ? above : below;

      const preferred = align === 'right' ? rect.right - width : rect.left;
      const left = Math.max(GUTTER_PX, Math.min(preferred, window.innerWidth - GUTTER_PX - width));

      setPosition({ top, left });
    };

    place();
    window.addEventListener('resize', place);
    // Capture, because the scroll that moves the anchor is usually a modal
    // body's, and scroll events do not bubble.
    window.addEventListener('scroll', place, true);

    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [active, anchorRef, panelRef, align]);

  return position;
}
