import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DashboardView } from '@/features/dashboard/DashboardView';
import {
  makeCalendarEvent,
  makeFunnel,
  makeSession,
  makeSources,
  makeStatusBreakdown,
  makeSummary,
  makeTimeline,
  makeTopCompanies,
  successBody,
} from '../utils/factories';
import { installMockApi, type MockApi, type Responder } from '../utils/mockAdapter';
import { renderWithProviders, resetClientState, signIn } from '../utils/render';
import { installThemeTokens, removeThemeTokens } from '../utils/themeTokens';

const MS_PER_DAY = 86_400_000;

function inDays(days: number): string {
  return new Date(Date.now() + days * MS_PER_DAY).toISOString();
}

function populatedRoutes(overrides: Record<string, Responder> = {}): Record<string, Responder> {
  return {
    'GET /analytics/summary': () => ({ status: 200, data: successBody(makeSummary()) }),
    'GET /analytics/status-breakdown': () => ({
      status: 200,
      data: successBody({ breakdown: makeStatusBreakdown() }),
    }),
    'GET /analytics/timeline': (request) => ({
      status: 200,
      data: successBody(
        makeTimeline({ granularity: request.params.granularity as 'day' | 'week' | 'month' }),
      ),
    }),
    'GET /analytics/by-source': () => ({
      status: 200,
      data: successBody({ sources: makeSources() }),
    }),
    'GET /analytics/funnel': () => ({ status: 200, data: successBody({ stages: makeFunnel() }) }),
    'GET /analytics/top-companies': () => ({
      status: 200,
      data: successBody({ companies: makeTopCompanies() }),
    }),
    'GET /calendar': () => ({
      status: 200,
      data: successBody({
        events: [
          makeCalendarEvent({ id: 'deadline:1', kind: 'deadline', at: inDays(3), company: 'Grab' }),
          // Two days rather than one: date-fns renders anything just under 24
          // hours in hours, and the assertion below is about the day wording.
          makeCalendarEvent({
            id: 'interview:1',
            kind: 'interview',
            at: inDays(2),
            company: 'Shopee',
          }),
          makeCalendarEvent({
            id: 'deadline:2',
            kind: 'deadline',
            at: inDays(9),
            company: 'Canva',
          }),
        ],
      }),
    }),
    ...overrides,
  };
}

function renderDashboard(overrides: Record<string, Responder> = {}): MockApi {
  const api = installMockApi(populatedRoutes(overrides));
  renderWithProviders(<DashboardView />);

  return api;
}

describe('dashboard', () => {
  beforeEach(() => {
    installThemeTokens();
    signIn(makeSession());
  });

  afterEach(() => {
    removeThemeTokens();
    resetClientState();
  });

  describe('stat cards', () => {
    it('shows the six headline numbers', async () => {
      renderDashboard();

      expect(await screen.findByText('Total')).toBeInTheDocument();
      for (const label of ['Active', 'Interviews', 'Offers', 'Response rate', 'Weekly goal']) {
        expect(screen.getByText(label)).toBeInTheDocument();
      }
      expect(screen.getByText('50%')).toBeInTheDocument();
      expect(screen.getByText('3/5')).toBeInTheDocument();
    });

    it('derives each delta from the period comparison', async () => {
      renderDashboard();
      await screen.findByText('Total');

      // The fixture created 12 in the current window against 8 in the previous
      // one, so the Total card shows +4 rather than either raw number.
      expect(screen.getAllByText('4').length).toBeGreaterThan(0);
      expect(screen.getAllByText(/vs previous 30 days/i)).toHaveLength(5);
      expect(screen.getByText(/vs last week/i)).toBeInTheDocument();
    });

    it('names the direction in text, not colour alone', async () => {
      renderDashboard();
      await screen.findByText('Total');

      expect(screen.getAllByText('Up').length).toBeGreaterThan(0);
    });

    it('asks the server for the window the cards claim to compare', async () => {
      const api = renderDashboard();
      await screen.findByText('Total');

      expect(api.callsTo('GET', '/analytics/summary')[0].params.periodDays).toBe('30');
    });
  });

  describe('charts', () => {
    it('renders all five Chart.js canvases plus the heatmap grid', async () => {
      renderDashboard();

      expect(await screen.findByTestId('timeline-chart')).toBeInTheDocument();
      expect(screen.getByTestId('status-doughnut')).toBeInTheDocument();
      expect(screen.getByTestId('source-bar')).toBeInTheDocument();
      expect(screen.getByTestId('funnel-bar')).toBeInTheDocument();
      expect(screen.getByTestId('top-companies-bar')).toBeInTheDocument();
      // Twelve weeks of seven days, drawn as elements rather than on a canvas.
      expect(screen.getAllByTestId('heatmap-cell')).toHaveLength(84);
    });

    it('refetches the timeline when the granularity switch is used', async () => {
      const user = userEvent.setup();
      const api = renderDashboard();
      await screen.findByTestId('timeline-chart');

      await user.click(screen.getByRole('button', { name: 'Month' }));

      await waitFor(() => {
        const granularities = api
          .callsTo('GET', '/analytics/timeline')
          .map((call) => call.params.granularity);

        expect(granularities).toContain('month');
      });
    });

    it('gives every chart a screen reader summary of its own data', async () => {
      renderDashboard();
      await screen.findByTestId('timeline-chart');

      // A canvas has no readable content, so each chart ships the same numbers
      // as a real table. Without these the dashboard is silent to a reader.
      const captions = [
        /applications added per week/i,
        /status breakdown of 42 applications/i,
        /applications by source/i,
        /conversion funnel from applied to offer/i,
        /companies applied to most often/i,
      ];

      for (const caption of captions) {
        expect(screen.getByText(caption)).toBeInTheDocument();
      }

      const funnelTable = screen.getByText(/conversion funnel from applied/i).closest('table');
      expect(funnelTable).not.toBeNull();
      expect(
        within(funnelTable as HTMLTableElement).getByText(/3 reached, 7.9% of applied/i),
      ).toBeInTheDocument();
    });

    it('describes the heatmap for a reader rather than leaving 84 bare cells', async () => {
      renderDashboard();

      expect(
        await screen.findByRole('img', { name: /activity heatmap: .* in the last 12 weeks/i }),
      ).toBeInTheDocument();
    });

    it('explains an empty chart instead of drawing nothing', async () => {
      renderDashboard({
        'GET /analytics/by-source': () => ({ status: 200, data: successBody({ sources: [] }) }),
      });
      await screen.findByTestId('timeline-chart');

      expect(screen.getByText(/no sources recorded yet/i)).toBeInTheDocument();
      expect(screen.queryByTestId('source-bar')).not.toBeInTheDocument();
    });

    it('offers a retry on one failed chart without losing the others', async () => {
      renderDashboard({ 'GET /analytics/funnel': () => ({ status: 500 }) });
      await screen.findByTestId('timeline-chart');

      expect(await screen.findByRole('button', { name: /try again/i })).toBeInTheDocument();
      expect(screen.getByTestId('status-doughnut')).toBeInTheDocument();
    });
  });

  describe('upcoming panel', () => {
    it('lists the next events soonest first, with relative dates', async () => {
      renderDashboard();

      const panel = (await screen.findByText('Upcoming')).closest('section');
      const items = within(panel as HTMLElement).getAllByRole('listitem');

      expect(items).toHaveLength(3);
      expect(within(items[0]).getByText('Shopee')).toBeInTheDocument();
      expect(within(items[0]).getByText(/in 2 days/i)).toBeInTheDocument();
      expect(within(items[1]).getByText(/in 3 days/i)).toBeInTheDocument();
    });

    it('shows at most five', async () => {
      renderDashboard({
        'GET /calendar': () => ({
          status: 200,
          data: successBody({
            events: Array.from({ length: 9 }, (_unused, index) =>
              makeCalendarEvent({ id: 'deadline:' + String(index), at: inDays(index + 1) }),
            ),
          }),
        }),
      });

      const panel = (await screen.findByText('Upcoming')).closest('section');

      await waitFor(() => {
        expect(within(panel as HTMLElement).getAllByRole('listitem')).toHaveLength(5);
      });
    });

    it('says so when nothing is scheduled', async () => {
      renderDashboard({
        'GET /calendar': () => ({ status: 200, data: successBody({ events: [] }) }),
      });

      expect(
        await screen.findByText(/nothing scheduled in the next few weeks/i),
      ).toBeInTheDocument();
    });
  });

  it('shows a skeleton before the summary lands, never a bare page', async () => {
    renderDashboard();

    expect(screen.getByTestId('dashboard-skeleton')).toBeInTheDocument();
    await screen.findByText('Total');
    expect(screen.queryByTestId('dashboard-skeleton')).not.toBeInTheDocument();
  });

  it('offers a retry when the summary itself fails', async () => {
    renderDashboard({ 'GET /analytics/summary': () => ({ status: 500 }) });

    expect(await screen.findByRole('button', { name: /try again/i })).toBeInTheDocument();
    expect(screen.queryByText('Total')).not.toBeInTheDocument();
  });
});
