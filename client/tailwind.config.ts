import type { Config } from 'tailwindcss';

/**
 * Every colour is a CSS custom property holding space-separated RGB channels, so
 * the same token works three ways: as a Tailwind utility (`bg-surface`), with an
 * opacity modifier (`bg-surface/60`), and as a raw value Chart.js can read at
 * runtime via `getComputedStyle(document.documentElement)` in Phase 8. The values
 * themselves live in `src/theme/tokens.json`, which `src/index.css` is generated
 * from, and are swapped by the `data-theme` attribute.
 *
 * `tests/config/tailwindTokens.test.ts` asserts that every token named here
 * exists in that file and vice versa, so the two cannot drift apart silently.
 */
function token(name: string): string {
  return `rgb(var(--${name}) / <alpha-value>)`;
}

/** The floating panel's lit top edge, the first layer of `shadow-float`. */
const FLOAT_LIFT = 'inset 0 1px 0 0 rgb(var(--atmos-lift) / var(--atmos-lift-peak))';

/** The rest of `shadow-float`: a tight contact shadow, then a wide coloured cast. */
const FLOAT_CAST = [
  '0 1px 2px 0 rgb(var(--color-shadow) / 0.08)',
  '0 2px 8px -4px rgb(var(--color-shadow) / 0.12)',
  '0 40px 80px -32px rgb(var(--atmos-cast) / var(--atmos-cast-peak))',
];

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  // `dark:` keys off the same attribute the inline boot script sets, so there is
  // one source of truth for the active theme rather than a class and an attribute.
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        canvas: token('color-canvas'),
        surface: token('color-surface'),
        'surface-muted': token('color-surface-muted'),
        // The saturated blue ground, used only on the auth split screen and
        // behind the marketing hero. Deliberately not the canvas: a page ground
        // this saturated forces every status colour to near-black to keep a 15%
        // pill tint legible on it. Nothing carrying a pill is painted on it.
        wash: token('color-wash'),
        // The marketing footer's giant wordmark. Decorative, but axe still
        // measures it as large text, so it is gated at 3:1 on the canvas.
        wordmark: token('color-wordmark'),
        border: token('color-border'),
        'border-strong': token('color-border-strong'),
        content: token('color-text'),
        'content-muted': token('color-text-muted'),
        'content-subtle': token('color-text-subtle'),
        primary: token('color-primary'),
        // The solid-fill pair is a separate token from the accent above. One value
        // cannot do both jobs in dark mode: a fill dark enough to carry white
        // text is far too dark to read as text on a card, and the readable
        // value is too light to read as anything but a pastel button.
        'primary-fill': token('color-primary-fill'),
        'primary-fill-hover': token('color-primary-fill-hover'),
        'primary-fill-fg': token('color-primary-fill-fg'),
        success: token('color-success'),
        warning: token('color-warning'),
        danger: token('color-danger'),
        'danger-fg': token('color-danger-fg'),
        // The danger button's hover, so it swaps a colour like the other three
        // variants rather than dimming the whole element with opacity.
        'danger-hover': token('color-danger-hover'),
        info: token('color-info'),
        // The four statuses that carry no semantic. The other four paint with
        // `info`, `warning`, `success` and `danger` because they mean those
        // things; see `lib/statusConfig.ts`.
        'status-saved': token('color-status-saved'),
        'status-assessment': token('color-status-assessment'),
        'status-ghosted': token('color-status-ghosted'),
        'status-withdrawn': token('color-status-withdrawn'),
        // Chart series and heatmap levels, so a chart colour is a token like
        // every other colour in the app rather than a literal in a JS object.
        'chart-1': token('color-chart-1'),
        'chart-2': token('color-chart-2'),
        'chart-3': token('color-chart-3'),
        'chart-4': token('color-chart-4'),
        'chart-5': token('color-chart-5'),
        'chart-6': token('color-chart-6'),
        'chart-7': token('color-chart-7'),
        'chart-8': token('color-chart-8'),
        'heat-0': token('color-heat-0'),
        'heat-1': token('color-heat-1'),
        'heat-2': token('color-heat-2'),
        'heat-3': token('color-heat-3'),
        'heat-4': token('color-heat-4'),
      },
      /*
       * Radii encode hierarchy rather than being one value used everywhere: a
       * dense data chip is squarer than a control, a control is squarer than a
       * panel. One radius on every element regardless of its weight is the
       * flattest tell of a templated interface, so components reach for one of
       * these rather than for `rounded-xl`.
       */
      borderRadius: {
        chip: '0.25rem',
        control: '0.375rem',
        card: '0.625rem',
        panel: '0.875rem',
      },
      fontFamily: {
        // One superfamily, two voices. The `wdth` build carries both the weight
        // and the width axis in a single file, so a heading set wide (the
        // `stretch-display` utility) costs no request beyond the body text.
        sans: [
          'Archivo Variable',
          'Archivo',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'sans-serif',
        ],
      },
      /*
       * The display scale, set once so a heading is picked off a scale rather
       * than reassembled from a size, a tracking and a weight at each call site.
       * Tracking tightens as the size grows, per Elements of Typographic Style.
       */
      fontSize: {
        'display-lg': [
          'clamp(2.5rem, 1.4rem + 4.6vw, 4.25rem)',
          { lineHeight: '0.94', letterSpacing: '-0.032em', fontWeight: '700' },
        ],
        'display-md': [
          'clamp(1.75rem, 1.2rem + 2.2vw, 2.5rem)',
          { lineHeight: '1.04', letterSpacing: '-0.022em', fontWeight: '650' },
        ],
        'display-sm': [
          '1.375rem',
          { lineHeight: '1.18', letterSpacing: '-0.014em', fontWeight: '600' },
        ],
        // The dashboard's headline numbers. Set wide and heavy, because on this
        // product the counts are the content.
        stat: ['1.625rem', { lineHeight: '1.05', letterSpacing: '-0.02em', fontWeight: '700' }],
      },
      boxShadow: {
        // Used sparingly, and only where something genuinely floats above the
        // page. Grouping elsewhere comes from rules and alignment rather than
        // from an identical soft shadow under every card.
        card: '0 1px 2px 0 rgb(var(--color-shadow) / 0.06), 0 8px 24px -12px rgb(var(--color-shadow) / 0.28)',
        panel:
          '0 1px 0 0 rgb(var(--color-shadow) / 0.04), 0 24px 60px -32px rgb(var(--color-shadow) / 0.45)',
        /*
         * A panel that genuinely floats, built from the atmosphere tokens: a lit
         * top edge, a tight contact shadow, then a wide *coloured* cast.
         *
         * The colour is the load-bearing part. A black shadow on a near-black
         * canvas is invisible, so a dark theme built on one reads flat however
         * large the blur gets. `--atmos-cast` is lighter than the dark canvas
         * rather than darker, which makes the same declaration read as a shadow
         * in light mode and as a glow in dark mode.
         */
        float: [FLOAT_LIFT, ...FLOAT_CAST].join(', '),
        /*
         * The same panel without its lit edge, for a panel whose edge is not its
         * padding box. An inset shadow is painted inside the border, so on the
         * select panel's 4px border it would land 4px below the edge; that panel
         * draws the lift itself (`.select-control::picker(select)` in index.css).
         */
        'float-cast': FLOAT_CAST.join(', '),
      },
      /*
       * Motion, given a scale for the same reason the radii have one.
       *
       * Every transition in the app was reaching for Tailwind's built-in
       * defaults, so the timing was consistent only by accident: 26 call sites
       * inherited 150ms and `cubic-bezier(0.4, 0, 0.2, 1)` without naming
       * either, while the two that wanted something else wrote `duration-200`
       * and `duration-700` as bare numbers. Nothing recorded what those
       * numbers meant, so the next component had nothing to copy from.
       *
       * `DEFAULT` is set rather than left implicit: in Tailwind v3 the
       * `transition-*` utilities read `transitionDuration.DEFAULT` and
       * `transitionTimingFunction.DEFAULT`, so naming them here tokenises every
       * existing call site without touching one of them.
       */
      transitionDuration: {
        /** A control changing state under the cursor. */
        DEFAULT: '150ms',
        /** A panel or drawer moving across the screen — further to travel. */
        panel: '200ms',
        /** A value animating into place, where the motion is the message. */
        data: '700ms',
      },
      transitionTimingFunction: {
        /*
         * Ease-out, replacing Tailwind's symmetric ease-in-out default. A state
         * change should leave immediately and settle at the end; easing into
         * the start delays the feedback the user is waiting for, which is why
         * both Material and the HIG specify decelerate for entering and for
         * state transitions.
         */
        DEFAULT: 'cubic-bezier(0.2, 0, 0, 1)',
      },
      /*
       * The native checkbox tick. Seven call sites reached for
       * `accent-[rgb(var(--color-primary))]`, which resolves the right colour
       * but does it as an arbitrary value — outside the theme, and so outside
       * the name parity `tests/config/tailwindTokens.test.ts` enforces. A token
       * spelled by hand at seven call sites is the shape of drift the palette
       * work already spent four fixes closing.
       */
      accentColor: {
        primary: token('color-primary'),
      },
      ringColor: {
        DEFAULT: token('color-ring'),
      },
      /*
       * Where the board is tall enough to be given the viewport's height, with
       * columns that scroll on their own and its sideways scrollbar kept on
       * screen. Below either bound it stays in the page's normal flow, so a
       * phone or a landscape phone never gets a nested scroll that can trap it.
       */
      screens: {
        'board-fit': { raw: '(min-width: 768px) and (min-height: 560px)' },
      },
    },
  },
  plugins: [],
} satisfies Config;
