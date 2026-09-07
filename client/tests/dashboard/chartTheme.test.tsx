import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Chart as ChartType, ChartOptions } from 'chart.js';
import { StatusDoughnut } from '@/features/dashboard/charts/StatusDoughnut';
import { TimelineChart } from '@/features/dashboard/charts/TimelineChart';
import { Chart } from '@/features/dashboard/charts/chartRegistry';
import { readChartPalette } from '@/features/dashboard/charts/chartTheme';
import { useThemeStore } from '@/store/themeStore';
import { makeStatusBreakdown, makeTimeline } from '../utils/factories';
import { resetClientState } from '../utils/render';
import { installThemeTokens, removeThemeTokens, tokenColor } from '../utils/themeTokens';

/**
 * Reaches the live Chart.js instance mounted on the page.
 *
 * Asserting here rather than on the props handed to a mocked chart component is
 * the whole point: this is the object Chart.js paints from, so if react-chartjs-2
 * failed to push the new options into it on a theme change, these reads would
 * still show the old palette and the test would fail.
 */
function liveChart(): ChartType {
  const canvas = document.querySelector('canvas');
  if (!canvas) throw new Error('No chart canvas was rendered');

  const chart = Chart.getChart(canvas);
  if (!chart) throw new Error('No Chart.js instance is attached to the canvas');

  return chart;
}

function tooltipBackground(chart: ChartType): unknown {
  return (chart.options as ChartOptions).plugins?.tooltip?.backgroundColor;
}

/** Flips the theme the way the toggle in the app does. */
async function setTheme(theme: 'light' | 'dark'): Promise<void> {
  await act(async () => {
    useThemeStore.getState().setPreference(theme);
    await Promise.resolve();
  });
}

describe('charts follow the theme', () => {
  beforeEach(() => {
    installThemeTokens();
  });

  afterEach(() => {
    removeThemeTokens();
    document.documentElement.removeAttribute('data-theme');
    resetClientState();
  });

  it('reads the palette from the shipped tokens, not from a copy of them', async () => {
    await setTheme('light');

    expect(readChartPalette().color('color-primary')).toBe(tokenColor('color-primary'));
    // The literal is not decoration. Without it the assertion above passes when
    // both sides are equally wrong -- an unresolved custom property makes
    // `readChartPalette` fall back and `tokenColor` return `rgb()`, and the two
    // agree on nothing. So one concrete value per theme is pinned, and it has to
    // be updated by hand whenever `src/index.css` ships a new palette. The
    // "Dispatch" redesign moved primary from indigo to jade, then jade to a deep
    // violet; these are the values that file now ships.
    expect(tokenColor('color-primary')).toBe('rgb(104 46 179)');

    await setTheme('dark');

    expect(readChartPalette().color('color-primary')).toBe(tokenColor('color-primary'));
    expect(tokenColor('color-primary')).toBe('rgb(178 151 234)');
  });

  it('repaints a mounted line chart when the theme is toggled', async () => {
    await setTheme('light');

    render(
      <TimelineChart
        timeline={makeTimeline()}
        granularity="week"
        onGranularityChange={() => undefined}
        isLoading={false}
        error={null}
        onRetry={() => undefined}
      />,
    );

    const lightPrimary = tokenColor('color-primary');
    const lightSurface = tokenColor('color-surface');
    const lightText = tokenColor('color-text');

    await waitFor(() => {
      expect(liveChart().data.datasets[0].borderColor).toBe(lightPrimary);
    });
    expect(tooltipBackground(liveChart())).toBe(lightSurface);
    expect(liveChart().options.plugins?.tooltip?.titleColor).toBe(lightText);

    await setTheme('dark');

    const darkPrimary = tokenColor('color-primary');
    const darkSurface = tokenColor('color-surface');
    const darkText = tokenColor('color-text');

    // The dark palette has to actually differ, or the assertions below would
    // pass on a chart that never repainted at all.
    expect(darkPrimary).not.toBe(lightPrimary);
    expect(darkSurface).not.toBe(lightSurface);

    await waitFor(() => {
      expect(liveChart().data.datasets[0].borderColor).toBe(darkPrimary);
    });
    // Tooltip colours are the usual place a fixed pixel colour hides, so they
    // are asserted on the live instance too, not just the dataset.
    expect(tooltipBackground(liveChart())).toBe(darkSurface);
    expect(liveChart().options.plugins?.tooltip?.titleColor).toBe(darkText);
    expect(liveChart().options.scales?.y?.grid?.color).toBe(
      `rgb(${getComputedStyle(document.documentElement).getPropertyValue('--color-border').trim()} / 0.7)`,
    );
  });

  it('keeps the same chart instance rather than remounting it', async () => {
    await setTheme('light');

    render(
      <TimelineChart
        timeline={makeTimeline()}
        granularity="week"
        onGranularityChange={() => undefined}
        isLoading={false}
        error={null}
        onRetry={() => undefined}
      />,
    );

    const before = liveChart();

    await setTheme('dark');

    // A remount would throw away the animation state and any open tooltip, so
    // the colours are pushed into the existing instance through update().
    expect(liveChart()).toBe(before);
  });

  it('repaints the doughnut slices and its custom legend together', async () => {
    await setTheme('light');

    render(
      <StatusDoughnut
        breakdown={makeStatusBreakdown()}
        isLoading={false}
        error={null}
        onRetry={() => undefined}
      />,
    );

    const lightOffer = tokenColor('color-success');

    await waitFor(() => {
      expect(liveChart().data.datasets[0].backgroundColor).toContain(lightOffer);
    });

    await setTheme('dark');

    const darkOffer = tokenColor('color-success');
    expect(darkOffer).not.toBe(lightOffer);

    await waitFor(() => {
      expect(liveChart().data.datasets[0].backgroundColor).toContain(darkOffer);
    });
    // The slice border is the card surface, so it has to move with the theme as
    // well or the doughnut keeps a white ring on a dark card.
    expect(liveChart().data.datasets[0].borderColor).toBe(tokenColor('color-surface'));
  });

  it('shows the centre total the doughnut canvas cannot carry', async () => {
    await setTheme('dark');

    render(
      <StatusDoughnut
        breakdown={makeStatusBreakdown()}
        isLoading={false}
        error={null}
        onRetry={() => undefined}
      />,
    );

    expect(screen.getByText('42')).toBeInTheDocument();
  });
});
