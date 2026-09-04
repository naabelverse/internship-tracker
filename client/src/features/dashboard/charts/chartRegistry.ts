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
} from 'chart.js';

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
);

export { Chart };
