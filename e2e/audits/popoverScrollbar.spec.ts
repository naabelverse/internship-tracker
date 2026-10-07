// Client address 16: 1 of 5 sign-ups per 15 minutes.
import { expect, type Locator, type Page } from '@playwright/test';
import { apiFor, newAccount, registerAccount } from '../support/api';
import { testForClient } from '../support/network';
import { signIn } from '../support/ui';

const test = testForClient(16);

/*
 * Headless Chromium hides scrollbars by default, which is how this bug stayed
 * out of every earlier capture. This file shows them, as Chrome on Windows does.
 */
test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } });

/**
 * The Filters menu scrolls (its list is taller than the panel's 20rem cap), and
 * a scroll container's scrollbar is drawn just inside its border. On the plain
 * card (`border p-2`) the bar ran flush against the edge and its square track
 * painted over both right-hand corners. On `.scroll-panel` the 4px transparent
 * border keeps it inside the rounded edge.
 *
 * Held two ways, at both ends of the scroll and in both themes:
 *
 * - Geometry: the scrollbar's outer corner lies inside the inner curve of the
 *   1px edge. On `main` it stood 3.73px past it.
 * - Paint: every pixel on or outside that edge, in both right-hand corners, is
 *   the same with the scrollbar as with `scrollbar-width: none`. On `main` the
 *   track changed those pixels by up to 40 levels.
 */
/*
 * Not 375: there a new account's toolbar wraps so that Filters sits at the right
 * edge and its panel runs off the screen, a positioning bug of its own. The
 * corner geometry is the same CSS at every width.
 */
const WIDTHS = [1440, 768] as const;
const THEMES = ['Light theme', 'Dark theme'] as const;
const CORNER = 14;

interface Geometry {
  scrolls: boolean;
  gutter: number;
  overhang: number;
  scrollbarColor: string;
}

async function geometry(panel: Locator): Promise<Geometry> {
  return panel.evaluate((el: HTMLElement) => {
    const cs = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const border = parseFloat(cs.borderRightWidth);
    const radius = parseFloat(cs.borderTopRightRadius);
    const gutter = el.offsetWidth - el.clientWidth - parseFloat(cs.borderLeftWidth) - border;
    // The bar's outer corner, (right - border, top + border), against the 1px
    // edge's inner curve, centred `radius` in from the corner. Symmetric at the bottom.
    const overhang =
      Math.hypot(radius - border, radius - parseFloat(cs.borderTopWidth)) - (radius - 1);

    return {
      scrolls: el.scrollHeight > el.clientHeight && rect.height > 0,
      gutter,
      overhang,
      scrollbarColor: cs.scrollbarColor,
    };
  });
}

/** RGB of every pixel whose centre is on or outside the edge, in both right-hand corners. */
async function edgePixels(page: Page, panel: Locator): Promise<number[]> {
  const box = await panel.boundingBox();
  if (!box) throw new Error('the Filters panel has no box');
  const radius = await panel.evaluate((el) =>
    parseFloat(getComputedStyle(el).borderTopRightRadius),
  );
  const right = box.x + box.width;
  const values: number[] = [];

  for (const atTop of [true, false]) {
    const clip = {
      x: Math.floor(right - CORNER),
      y: atTop ? Math.floor(box.y) : Math.ceil(box.y + box.height) - CORNER,
      width: CORNER,
      height: CORNER,
    };
    const png = await page.screenshot({ clip });
    const rgba = await page.evaluate(async (base64) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d');
      context?.drawImage(image, 0, 0);
      return Array.from(context?.getImageData(0, 0, image.width, image.height).data ?? []);
    }, png.toString('base64'));

    const centreX = right - radius;
    const centreY = atTop ? box.y + radius : box.y + box.height - radius;
    for (let row = 0; row < CORNER; row += 1) {
      for (let column = 0; column < CORNER; column += 1) {
        const x = clip.x + column + 0.5;
        const y = clip.y + row + 0.5;
        const inQuadrant = x > centreX && (atTop ? y < centreY : y > centreY);
        if (!inQuadrant || Math.hypot(x - centreX, y - centreY) < radius - 1) continue;
        const index = (row * CORNER + column) * 4;
        values.push(rgba[index] ?? 0, rgba[index + 1] ?? 0, rgba[index + 2] ?? 0);
      }
    }
  }

  return values;
}

test('a scrolling Filters panel keeps its scrollbar inside the rounded corners', async ({
  page,
}) => {
  const account = newAccount('popover');
  const api = await apiFor(16);
  await registerAccount(api, account);
  await signIn(page, account);
  await page.getByRole('link', { name: 'Applications' }).first().click();
  const trigger = page.getByRole('button', { name: /^Filters/ });
  await expect(trigger).toBeVisible();

  for (const theme of THEMES) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole('radio', { name: theme }).first().click();
    await expect(page.locator('html')).toHaveAttribute(
      'data-theme',
      theme === 'Light theme' ? 'light' : 'dark',
    );

    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      await trigger.click();
      const panel = page.getByRole('group', { name: 'Filters', exact: true });
      await expect(panel).toBeVisible();
      await page.mouse.move(1, 1);

      for (const end of ['top', 'end'] as const) {
        const where = `${theme}, ${String(width)}px, scrolled to the ${end}`;
        await panel.evaluate((el, toEnd) => {
          el.scrollTop = toEnd ? el.scrollHeight : 0;
        }, end === 'end');

        const shape = await geometry(panel);
        expect(shape.scrolls, `${where}: the panel should scroll`).toBe(true);
        expect(shape.gutter, `${where}: no real scrollbar was drawn`).toBeGreaterThan(0);
        // Soft from here: one run reports colour, geometry and paint together.
        expect
          .soft(shape.scrollbarColor, `${where}: the scrollbar is the browser default`)
          .not.toBe('auto');
        expect
          .soft(shape.overhang, `${where}: the scrollbar reaches past the edge`)
          .toBeLessThan(0);

        const withBar = await edgePixels(page, panel);
        await panel.evaluate((el) => {
          el.style.setProperty('scrollbar-width', 'none');
        });
        const withoutBar = await edgePixels(page, panel);
        await panel.evaluate((el) => {
          el.style.removeProperty('scrollbar-width');
        });

        expect(withBar.length, `${where}: no corner pixels were sampled`).toBeGreaterThan(0);
        const changed = withBar.reduce(
          (most, value, index) => Math.max(most, Math.abs(value - (withoutBar[index] ?? 0))),
          0,
        );
        expect
          .soft(changed, `${where}: the scrollbar paints over the corners`)
          .toBeLessThanOrEqual(2);
      }

      await page.keyboard.press('Escape');
      await expect(panel).toBeHidden();
    }
  }
});
