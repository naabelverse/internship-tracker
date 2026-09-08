/**
 * The geometry of the brand mark, in one place.
 *
 * The mark used to be three `<rect>`s written out three times — once in
 * `BrandMark`, once in `markSvg` next door, once inline in the OG image — with
 * nothing tying the copies together. That is the same shape of bug
 * `brandPalette.mjs` exists to fix for the colours: a change to one copy leaves
 * the rest silently stale, which is how the favicons kept a primary the app had
 * stopped using. The path lives here and every drawn instance derives from it.
 *
 * Plain `.mjs` for the reason `brandPalette.mjs` is: it runs from npm before
 * Vite or tsc are involved. `BrandMark` cannot import across that boundary, so
 * it restates the path and `tests/config/brandMark.test.tsx` asserts the two
 * still agree — the same way the palette test ties the committed assets to the
 * tokens rather than trusting them to be re-run.
 *
 * Nothing here is a colour. The tiles take theirs from `readBrandPalette()` and
 * `BrandMark` paints in `currentColor`, so both ends resolve `--color-primary`
 * from `src/index.css` and neither holds a hex of its own.
 */

/**
 * An angular fold: a flat-topped bar chamfered off at the left, turning down
 * the right-hand side into a point.
 *
 * Seven points, straight edges, no curves — it has to survive a 16 px favicon,
 * and at that size a curve is a smudge. Drawn on a 512 grid so every coordinate
 * is a whole number, and centred in it: the glyph spans x 96-416 and y 112-400,
 * leaving 96 either side and 112 above and below.
 *
 * The left arm is 32 units deep at its tip rather than the 16 it was drawn at.
 * At 16 px that is the difference between a whole pixel and half of one, and
 * the half-pixel version rendered the arm as a grey tint rather than a stroke.
 */
export const MARK_PATH = 'M176 112H416V280L296 400V200H96V168Z';

/** The padded box. The icon tiles need air between the glyph and the corners. */
export const MARK_BOX = '0 0 512 512';

/**
 * The glyph's own bounds, squared off.
 *
 * Set beside type — the header, the footer, the auth panel, the OG masthead —
 * the padded box draws the mark visibly smaller than the wordmark next to it,
 * because the glyph fills only 62% of it. Framing on the glyph restores the
 * optical weight the three-bar mark had at the same `h-4 w-4`.
 */
export const MARK_BOX_TIGHT = '96 96 320 320';

/** The tile's corner radius: the 22.5% that `rx="3.6"` came to on a 16 grid. */
export const TILE_RADIUS = 115.2;
