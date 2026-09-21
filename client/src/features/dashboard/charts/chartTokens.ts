/**
 * The token names the charts read, and the orders they are read in.
 *
 * Split out of `chartTheme.ts` so these lists can be imported by something that
 * is not a React module. `tests/a11y/tokenContrast.test.ts` asserts that no two
 * entries in `SERIES_TOKENS` resolve to the same colour, and it has to check the
 * list the app actually ships rather than a copy of it — a restated copy is
 * exactly how the duplication that assertion exists to catch went unnoticed.
 */
export const TOKENS = [
  'color-surface',
  'color-surface-muted',
  'color-border',
  'color-border-strong',
  'color-text',
  'color-text-muted',
  'color-text-subtle',
  'color-primary',
  'color-success',
  'color-warning',
  'color-danger',
  'color-info',
  'color-status-saved',
  'color-status-assessment',
  'color-status-ghosted',
  'color-status-withdrawn',
  'color-chart-1',
  'color-chart-2',
  'color-chart-3',
  'color-chart-4',
  'color-chart-5',
  'color-chart-6',
  'color-chart-7',
  'color-chart-8',
] as const;

export type TokenName = (typeof TOKENS)[number];

/**
 * The categorical series, in the order a chart consumes it.
 *
 * Every entry is a dedicated `chart-*` token. It used to end with `color-info`
 * and `color-success`, which are byte-identical to `color-chart-2` and
 * `color-chart-4`, so a seven-category chart painted two categories the same
 * blue. `Source` has exactly seven values, so that was firing on the dashboard
 * rather than being a theoretical overflow case.
 *
 * Semantic tokens are deliberately not reused here. Their values are owned by
 * what they mean, so any future change to `info` or `success` would silently
 * reintroduce a collision. Categorical colour needs tokens whose only job is to
 * differ from one another.
 */
export const SERIES_TOKENS: TokenName[] = [
  'color-chart-1',
  'color-chart-2',
  'color-chart-3',
  'color-chart-4',
  'color-chart-5',
  'color-chart-6',
  'color-chart-7',
  'color-chart-8',
];
