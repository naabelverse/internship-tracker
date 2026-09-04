import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DashboardView } from '@/features/dashboard/DashboardView';
import {
  errorBody,
  makeEmptySummary,
  makeSession,
  makeStatusBreakdown,
  makeSummary,
  successBody,
} from '../utils/factories';
import { installMockApi, type Responder } from '../utils/mockAdapter';
import { renderWithProviders, resetClientState, signIn } from '../utils/render';
import { installThemeTokens, removeThemeTokens } from '../utils/themeTokens';

/** Every dashboard request answered, so only the summary decides the view. */
function emptyAccountRoutes(overrides: Record<string, Responder> = {}): Record<string, Responder> {
  return {
    'GET /analytics/summary': () => ({ status: 200, data: successBody(makeEmptySummary()) }),
    'GET /analytics/status-breakdown': () => ({
      status: 200,
      data: successBody({ breakdown: [] }),
    }),
    'GET /analytics/timeline': () => ({
      status: 200,
      data: successBody({ granularity: 'day', range: '90d', points: [] }),
    }),
    'GET /analytics/by-source': () => ({ status: 200, data: successBody({ sources: [] }) }),
    'GET /analytics/funnel': () => ({ status: 200, data: successBody({ stages: [] }) }),
    'GET /analytics/top-companies': () => ({ status: 200, data: successBody({ companies: [] }) }),
    'GET /calendar': () => ({ status: 200, data: successBody({ events: [] }) }),
    ...overrides,
  };
}

describe('dashboard empty state', () => {
  beforeEach(() => {
    installThemeTokens();
    signIn(makeSession());
  });

  afterEach(() => {
    removeThemeTokens();
    resetClientState();
  });

  it('offers a create CTA and a demo data button instead of blank charts', async () => {
    installMockApi(emptyAccountRoutes());

    renderWithProviders(<DashboardView />);

    expect(
      await screen.findByRole('button', { name: /add your first application/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /load demo data/i })).toBeInTheDocument();
    expect(
      screen.getByText(/your dashboard is waiting on its first application/i),
    ).toBeInTheDocument();
  });

  it('renders no charts at all rather than five empty canvases', async () => {
    installMockApi(emptyAccountRoutes());

    renderWithProviders(<DashboardView />);
    await screen.findByRole('button', { name: /load demo data/i });

    // The failure this guards against is six charts silently drawing nothing,
    // with no explanation of why the page looks broken.
    expect(document.querySelectorAll('canvas')).toHaveLength(0);
    expect(screen.queryByTestId('status-doughnut')).not.toBeInTheDocument();
    expect(screen.queryByTestId('funnel-bar')).not.toBeInTheDocument();
    expect(screen.queryByTestId('heatmap-cell')).not.toBeInTheDocument();
  });

  it('opens the create modal from the CTA', async () => {
    const user = userEvent.setup();
    installMockApi(emptyAccountRoutes());

    renderWithProviders(<DashboardView />);
    await user.click(await screen.findByRole('button', { name: /add your first application/i }));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText('Company')).toBeInTheDocument();
  });

  it('replaces the empty state with the real dashboard once demo data lands', async () => {
    const user = userEvent.setup();
    let loaded = false;

    const api = installMockApi(
      emptyAccountRoutes({
        'GET /analytics/summary': () => ({
          status: 200,
          data: successBody(loaded ? makeSummary() : makeEmptySummary()),
        }),
        'GET /analytics/status-breakdown': () => ({
          status: 200,
          data: successBody({ breakdown: loaded ? makeStatusBreakdown() : [] }),
        }),
        'POST /applications/demo-data': () => {
          loaded = true;
          return { status: 201, data: successBody({ inserted: 64 }) };
        },
      }),
    );

    renderWithProviders(<DashboardView />);
    await user.click(await screen.findByRole('button', { name: /load demo data/i }));

    await waitFor(() => {
      expect(api.callsTo('POST', '/applications/demo-data')).toHaveLength(1);
    });
    // Everything on this page is derived from applications, so the whole
    // analytics tree is refetched rather than patched, and the empty state has
    // to give way to the charts without a reload.
    expect(await screen.findByTestId('status-doughnut')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /load demo data/i })).not.toBeInTheDocument();
  });

  it('keeps the empty state usable when demo data is refused', async () => {
    const user = userEvent.setup();

    installMockApi(
      emptyAccountRoutes({
        'POST /applications/demo-data': () => ({
          status: 409,
          data: errorBody('This account already has applications.', 'DEMO_DATA_NOT_EMPTY'),
        }),
      }),
    );

    renderWithProviders(<DashboardView />);
    await user.click(await screen.findByRole('button', { name: /load demo data/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /load demo data/i })).toBeEnabled();
    });
    expect(screen.getByRole('button', { name: /add your first application/i })).toBeInTheDocument();
  });
});
