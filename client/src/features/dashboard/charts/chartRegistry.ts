import {
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  Filler,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
  type Plugin,
} from 'chart.js';

/**
 * Applies a resize Chart.js deferred and then dropped (issue #118).
 *
 * Chart.js 4.5 parks a resize that arrives mid-animation in `_resizeBeforeDraw`
 * for the next `draw()`. If it lands between the animation's last drawn frame
 * and the frame that marks it finished, that draw never comes and the canvas
 * keeps its old width: 1440 → 375 left a 510px chart in a 309px card.
 * `afterRender` runs as the animation finishes, so a size still parked there
 * gets the draw it was waiting for, using the observer's own measurement.
 *
 * It must not call `resize()` itself. `retinaScale` compares the integer
 * `canvas.width` with a one-decimal device width, so on a fractional container
 * (699.3px) every resize re-renders, and resizing after each render recursed
 * until the stack overflowed.
 */
const recoverLostResize: Plugin = {
  id: 'recoverLostResize',
  afterRender(chart) {
    // Chart.js-internal field; chartResize.test.ts fails if a release renames it.
    if ((chart as unknown as { _resizeBeforeDraw?: object | null })._resizeBeforeDraw) {
      chart.draw();
    }
  },
};

/**
 * Only the pieces the five charts actually draw.
 *
 * SPEC section 12 forbids `chart.js/auto`: that import pulls in every
 * controller, scale and plugin Chart.js ships, including radar, polar area and
 * the time scale, none of which this dashboard renders. Registering by hand is
 * what lets the bundler drop the rest.
 *
 * `Legend` is deliberately absent — every legend on this page is our own markup,
 * which is what SPEC section 6 asks for on the doughnut and what keeps the
 * legends keyboard reachable and themed like the rest of the app.
 */
Chart.register(
  LineController,
  LineElement,
  PointElement,
  BarController,
  BarElement,
  ArcElement,
  CategoryScale,
  LinearScale,
  Filler,
  Tooltip,
  recoverLostResize,
);

export { Chart };
