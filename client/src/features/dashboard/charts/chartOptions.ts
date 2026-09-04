import type { ChartOptions, ScaleOptions, TooltipOptions } from 'chart.js';
import type { ChartPalette } from '@/features/dashboard/charts/chartTheme';

/** SPEC section 6: charts animate on mount. */
const MOUNT_ANIMATION = { duration: 600, easing: 'easeOutQuart' as const };

/**
 * The tooltip, themed.
 *
 * Chart.js defaults the tooltip to an opaque near-black box with white text,
 * which is a fixed pixel colour and unreadable on a light canvas. Every one of
 * these values is a token, so the tooltip re-themes with everything else.
 */
function tooltip(palette: ChartPalette): Partial<TooltipOptions> {
  return {
    backgroundColor: palette.color('color-surface'),
    titleColor: palette.color('color-text'),
    bodyColor: palette.color('color-text-muted'),
    borderColor: palette.color('color-border-strong'),
    borderWidth: 1,
    padding: 10,
    cornerRadius: 8,
    displayColors: true,
    boxPadding: 4,
  };
}

/** Legends are our own markup, so Chart.js should never draw one. */
export function basePlugins(palette: ChartPalette): ChartOptions['plugins'] {
  return { legend: { display: false }, tooltip: tooltip(palette) };
}

function categoryScale(palette: ChartPalette): ScaleOptions<'category'> {
  return {
    type: 'category',
    grid: { display: false },
    border: { color: palette.color('color-border') },
    ticks: { color: palette.color('color-text-subtle'), font: { size: 11 } },
  } as ScaleOptions<'category'>;
}

function valueScale(palette: ChartPalette): ScaleOptions<'linear'> {
  return {
    type: 'linear',
    beginAtZero: true,
    grid: { color: palette.color('color-border', 0.7) },
    border: { display: false },
    ticks: { color: palette.color('color-text-subtle'), font: { size: 11 }, precision: 0 },
  } as ScaleOptions<'linear'>;
}

/** Shared shell for the cartesian charts: vertical bars and the line. */
export function verticalOptions(palette: ChartPalette): ChartOptions<'bar' | 'line'> {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: MOUNT_ANIMATION,
    interaction: { mode: 'index', intersect: false },
    plugins: basePlugins(palette),
    scales: { x: categoryScale(palette), y: valueScale(palette) },
  };
}

/** Shared shell for the horizontal bars: the funnel and top companies. */
export function horizontalOptions(palette: ChartPalette): ChartOptions<'bar'> {
  return {
    indexAxis: 'y',
    responsive: true,
    maintainAspectRatio: false,
    animation: MOUNT_ANIMATION,
    plugins: basePlugins(palette),
    scales: { x: valueScale(palette), y: categoryScale(palette) },
  };
}

export function doughnutOptions(palette: ChartPalette): ChartOptions<'doughnut'> {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: MOUNT_ANIMATION,
    cutout: '68%',
    plugins: basePlugins(palette),
  };
}
