import { afterEach, describe, expect, it, vi } from 'vitest';
import { Chart } from '@/features/dashboard/charts/chartRegistry';

/**
 * Issue #118. A resize landing between an animation's last drawn frame and the
 * frame that ends it stayed parked in Chart.js's `_resizeBeforeDraw`, leaving a
 * 510px canvas in a 309px card after 1440 → 375. These run against a real
 * Chart.js instance, so a release that renames that field fails here.
 */
type Parked = { _resizeBeforeDraw: { width: number; height: number } | null };

function makeChart(): Chart {
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  return new Chart(canvas, {
    type: 'bar',
    data: { labels: ['a'], datasets: [{ data: [1] }] },
    options: { animation: false, responsive: false },
  });
}

function recoverLostResize() {
  const plugin = Chart.registry.getPlugin('recoverLostResize');
  if (!plugin?.afterRender) throw new Error('recoverLostResize is not registered');
  return plugin.afterRender.bind(plugin);
}

describe('the chart registry applies a resize Chart.js parked and never drew', () => {
  let chart: Chart | undefined;

  afterEach(() => {
    chart?.destroy();
    document.body.innerHTML = '';
  });

  it('draws a parked resize when the render finishes', () => {
    chart = makeChart();
    (chart as unknown as Parked)._resizeBeforeDraw = { width: 120, height: 60 };

    recoverLostResize()(chart, {}, {});

    expect(chart.width).toBe(120);
    expect(chart.height).toBe(60);
    expect((chart as unknown as Parked)._resizeBeforeDraw).toBeNull();
  });

  it('does nothing when no resize is parked', () => {
    chart = makeChart();
    const draw = vi.spyOn(chart, 'draw');
    const resize = vi.spyOn(chart, 'resize');

    recoverLostResize()(chart, {}, {});

    expect(draw).not.toHaveBeenCalled();
    expect(resize).not.toHaveBeenCalled();
  });
});
