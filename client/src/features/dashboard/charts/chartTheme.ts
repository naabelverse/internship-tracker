import { useMemo } from 'react';
import { useThemeStore } from '@/store/themeStore';
import type { ApplicationStatus } from '@/types/application';

/**
 * The token names the charts read. Each holds space-separated RGB channels, the
 * same values Tailwind wraps for `bg-*` utilities, so a chart and a pill painted
 * "primary" are painted the identical colour.
 */
const TOKENS = [
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
  'color-chart-1',
  'color-chart-2',
  'color-chart-3',
  'color-chart-4',
  'color-chart-5',
  'color-chart-6',
] as const;

type TokenName = (typeof TOKENS)[number];

export interface ChartPalette {
  /** `rgb(r g b)` for a token, or `rgb(r g b / a)` when an alpha is given. */
  color: (token: TokenName, alpha?: number) => string;
  /** The categorical series, long enough for the eight statuses. */
  series: string[];
  /** Matches the status pills used everywhere else in the app. */
  statusColor: (status: ApplicationStatus) => string;
}

/**
 * Statuses keep the colour their pill has, so a slice and a badge for the same
 * status never disagree. Ghosted and withdrawn share a grey pill but get
 * separate chart tokens, because two identical slices would be unreadable.
 */
const STATUS_TOKENS: Record<ApplicationStatus, TokenName> = {
  saved: 'color-text-subtle',
  applied: 'color-info',
  assessment: 'color-primary',
  interview: 'color-warning',
  offer: 'color-success',
  rejected: 'color-danger',
  ghosted: 'color-chart-5',
  withdrawn: 'color-chart-6',
};

const SERIES_TOKENS: TokenName[] = [
  'color-chart-1',
  'color-chart-2',
  'color-chart-3',
  'color-chart-4',
  'color-chart-5',
  'color-chart-6',
  'color-info',
  'color-success',
];

/**
 * Fallback channels for a document whose stylesheet has not been applied — a
 * server render, or a test that has not injected the token block. Reading a
 * token that resolved to an empty string would hand Chart.js `rgb( )`, which it
 * silently paints black, so the failure has to be caught here rather than seen.
 */
const FALLBACK = '148 163 184';

function readChannels(styles: CSSStyleDeclaration, token: TokenName): string {
  const value = styles.getPropertyValue(`--${token}`).trim();

  return value === '' ? FALLBACK : value;
}

/**
 * Snapshots every token off the document element.
 *
 * This is deliberately a plain read rather than a cached module constant:
 * Chart.js resolves colours once, when it is handed an options object, and has
 * no idea a CSS variable exists. Re-reading on each theme change and handing the
 * result back to the chart is what keeps a rendered chart honest after a toggle.
 */
export function readChartPalette(): ChartPalette {
  const styles = getComputedStyle(document.documentElement);
  const channels = new Map<TokenName, string>(
    TOKENS.map((token) => [token, readChannels(styles, token)]),
  );

  const color = (token: TokenName, alpha?: number): string => {
    const rgb = channels.get(token) ?? FALLBACK;

    return alpha === undefined ? `rgb(${rgb})` : `rgb(${rgb} / ${String(alpha)})`;
  };

  return {
    color,
    series: SERIES_TOKENS.map((token) => color(token)),
    statusColor: (status) => color(STATUS_TOKENS[status]),
  };
}

/**
 * The palette for the active theme, recomputed whenever the theme changes.
 *
 * `resolved` is the theme actually painted, and the store sets it in the same
 * action that writes `data-theme` onto the document element. Keying the memo on
 * it means the read below always happens after the attribute flip, so the values
 * that come back are the new palette rather than the outgoing one.
 */
export function useChartPalette(): ChartPalette {
  const resolved = useThemeStore((state) => state.resolved);

  // `resolved` is not referenced inside the factory, but it is the input:
  // `readChartPalette` reads custom properties off the document element, and
  // which values those resolve to is decided entirely by the `data-theme`
  // attribute the store writes alongside this value. The rule only sees
  // identifiers, so it cannot know that.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => readChartPalette(), [resolved]);
}
