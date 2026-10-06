// Client address 11: 0 of 5 sign-ups per 15 minutes.
import { expect, type Page } from '@playwright/test';
import { testForClient } from '../support/network';

const test = testForClient(11);

/**
 * Issue #26: the auth lockup is a `146x20` link. Wide enough, but 20px tall —
 * half of the 40px a pointer or a thumb wants, and the phone copy is the one
 * that matters, since below `lg` it is the only chrome the page has.
 *
 * The target is measured the way the browser resolves a click rather than read
 * off the element's box: from the link's centre this walks outwards in
 * half-pixel steps, asking `document.elementFromPoint` at each step whether
 * that point still dispatches to the link, and stops where it stops. A
 * class-shape assertion cannot do that job here, because every way this fix can
 * fail silently still leaves the classes in place — a `before:` variant on a
 * `position: static` element, a pseudo-element with no `content`, an `h-10`
 * that a later utility overrides. Only the walk tells those apart from a fix
 * that works.
 *
 * The second half of the contract is that this is a hit-area change and
 * nothing else: the visible box stays exactly as tall as it was, which is what
 * fails if someone later "simplifies" this into padding.
 */
const MIN_TARGET = 40;

/** The link's own box, set by `text-sm`'s 20px line box over a 16px mark. */
const VISUAL_HEIGHT = 20;

const ROUTES = [
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/verify-email',
  '/account-closed',
] as const;

/** The widths SPEC section 17 pins, plus 1024 — where the split screen appears. */
const WIDTHS = [375, 768, 1024, 1440] as const;

const THEMES = ['light', 'dark'] as const;

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Measured {
  /** Which of the two copies CSS is showing at this width. */
  which: 'aside' | 'bar';
  visual: Box;
  hit: Box;
  toggle: Box | null;
}

/**
 * Walks the real clickable extent of the auth lockup, plus the boxes either
 * side of the question: the link's own painted box, and the theme toggle it
 * shares the phone bar with.
 */
async function measureLockup(page: Page): Promise<Measured> {
  return page.evaluate(() => {
    const round = (n: number): number => Math.round(n * 100) / 100;
    const box = (el: Element | null): Box | null => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: round(r.x), y: round(r.y), w: round(r.width), h: round(r.height) };
    };
    const shown = (el: Element | null): boolean => !!el && el.getClientRects().length > 0;
    const lockup = (root: Element | null): HTMLAnchorElement | null =>
      root
        ? ([...root.querySelectorAll('a')].find(
            (a) => a.textContent?.trim() === 'Internship Tracker',
          ) ?? null)
        : null;

    const asideLink = lockup(document.querySelector('aside'));
    const barLink = lockup(document.querySelector('main'));
    const live = shown(asideLink) ? asideLink : shown(barLink) ? barLink : null;
    if (!live) throw new Error('no visible lockup on this page');

    const visual = box(live);
    if (!visual) throw new Error('the lockup has no box');

    // Hit testing, not box reading: a pseudo-element resolves to the element
    // that generated it, so a point inside the expanded area comes back as the
    // link itself and a point past its edge comes back as whatever is behind.
    const cx = visual.x + visual.w / 2;
    const cy = visual.y + visual.h / 2;
    const owns = (x: number, y: number): boolean => {
      const hit = document.elementFromPoint(x, y);
      return !!hit && (hit === live || live.contains(hit));
    };
    if (!owns(cx, cy)) throw new Error('the lockup does not even own its own centre');

    const STEP = 0.5;
    // Generous, but bounded: an unbounded walk on a broken build runs to the
    // viewport edge in half-pixels and reads as a hang rather than a failure.
    const LIMIT = 300;
    let top = cy;
    let bottom = cy;
    let left = cx;
    let right = cx;
    while (cy - top < LIMIT && owns(cx, top - STEP)) top -= STEP;
    while (bottom - cy < LIMIT && owns(cx, bottom + STEP)) bottom += STEP;
    while (cx - left < LIMIT && owns(left - STEP, cy)) left -= STEP;
    while (right - cx < LIMIT && owns(right + STEP, cy)) right += STEP;

    return {
      which: shown(asideLink) ? 'aside' : 'bar',
      visual,
      hit: { x: round(left), y: round(top), w: round(right - left), h: round(bottom - top) },
      toggle: box(document.querySelector('[role="radiogroup"][aria-label="Theme"]')),
    };
  });
}

/** True when two boxes share any area at all. */
function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

for (const width of WIDTHS) {
  test(`the auth lockup is a ${String(MIN_TARGET)}px target at ${String(width)}px`, async ({
    page,
  }) => {
    const tooSmall: string[] = [];
    const moved: string[] = [];
    const collided: string[] = [];

    console.log(`\nviewport ${String(width)}px`);

    for (const theme of THEMES) {
      await page.addInitScript(
        ([key, value]) => {
          window.localStorage.setItem(key, value);
        },
        ['internship-tracker.theme', theme],
      );

      for (const route of ROUTES) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(route);
        await expect(page.getByRole('link', { name: 'Internship Tracker' }).first()).toBeVisible();
        // Checked rather than assumed: if the storage key ever moved, both
        // passes would quietly run in the same theme and this test would stay
        // green while claiming to cover two.
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        // Layout settles a frame after the route paints.
        await page.waitForTimeout(250);

        const { which, visual, hit, toggle } = await measureLockup(page);
        const where = `${route} ${theme} @${String(width)}`;

        console.log(
          `  ${where} (${which}) visual ${String(visual.w)}x${String(visual.h)} ` +
            `hit ${String(hit.w)}x${String(hit.h)}`,
        );

        if (hit.h < MIN_TARGET || hit.w < MIN_TARGET) {
          tooSmall.push(`${where}: ${String(hit.w)}x${String(hit.h)}`);
        }

        // The hit area is allowed to grow; the painted lockup is not allowed to
        // move or change size. Padding would fail here rather than above.
        if (visual.h !== VISUAL_HEIGHT) {
          moved.push(
            `${where}: visible height ${String(visual.h)}, expected ${String(VISUAL_HEIGHT)}`,
          );
        }

        // Centred growth, so the lockup sits in the middle of its own target
        // rather than at one edge of it.
        const visualCentre = visual.y + visual.h / 2;
        const hitCentre = hit.y + hit.h / 2;
        if (Math.abs(visualCentre - hitCentre) > 1) {
          moved.push(`${where}: target is off-centre by ${String(visualCentre - hitCentre)}px`);
        }

        // Below `lg` the lockup and the theme toggle are the two ends of one
        // row. A target that grew into its neighbour would trade one defect
        // for a worse one.
        if (toggle && overlaps(hit, toggle)) {
          collided.push(`${where}: target overlaps the theme toggle`);
        }
      }
    }

    expect(tooSmall, `these lockups are under ${String(MIN_TARGET)}x${String(MIN_TARGET)}`).toEqual(
      [],
    );
    expect(moved, 'the visible lockup moved or resized — this is a hit-area fix only').toEqual([]);
    expect(collided, 'the expanded target reaches an adjacent control').toEqual([]);
  });
}
