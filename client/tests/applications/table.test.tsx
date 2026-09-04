import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '@/App';
import ApplicationsPage from '@/pages/ApplicationsPage';
import { COLUMN_STORAGE_KEY } from '@/features/applications/columns';
import { errorBody, makeApplication, makeListResponse, makeSession } from '../utils/factories';
import { createGate, installMockApi, type MockApi, type Responder } from '../utils/mockAdapter';
import { renderWithProviders, resetClientState, signIn } from '../utils/render';

const LIST = 'GET /applications';

const rows = [
  makeApplication({ id: 'app-1', company: 'Stripe', role: 'Backend Intern', status: 'applied' }),
  makeApplication({ id: 'app-2', company: 'Figma', role: 'Design Engineer', status: 'interview' }),
];

function renderTable(routes: Record<string, Responder> = {}, route = '/applications'): MockApi {
  const mock = installMockApi({
    [LIST]: () => ({ status: 200, data: makeListResponse(rows, { total: 42 }) }),
    ...routes,
  });
  signIn(makeSession());
  renderWithProviders(<App />, { route });

  return mock;
}

beforeEach(() => {
  resetClientState();
});

afterEach(() => {
  resetClientState();
});

describe('applications table', () => {
  it('shows a skeleton before the first page arrives, not a bare spinner', async () => {
    // The page is rendered directly rather than through `<App />`. Since Phase 13
    // this route is lazy, so going through the router would race the chunk load
    // against the request; this case is about the page's own loading state. The
    // response is gated so that state persists long enough to observe.
    const gate = createGate();
    installMockApi({
      [LIST]: async () => {
        await gate.wait;
        return { status: 200, data: makeListResponse([]) };
      },
    });
    signIn(makeSession());

    renderWithProviders(<ApplicationsPage />, { route: '/applications' });

    expect(await screen.findByTestId('applications-skeleton')).toBeInTheDocument();

    gate.open();
  });

  it('renders the rows the server returned', async () => {
    renderTable();

    expect(await screen.findByText('Stripe')).toBeInTheDocument();
    expect(screen.getByText('Figma')).toBeInTheDocument();
    expect(screen.getByText('42 tracked')).toBeInTheDocument();
  });

  it('offers an empty state that clears the filters when a filter matched nothing', async () => {
    const user = userEvent.setup();
    renderTable(
      { [LIST]: () => ({ status: 200, data: makeListResponse([]) }) },
      '/applications?search=nothing',
    );

    expect(await screen.findByText('Nothing matches those filters')).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: 'Clear filters' })[0]);

    await waitFor(() => {
      expect(screen.getByText('No applications yet')).toBeInTheDocument();
    });
  });

  it('shows an error state with a retry when the list fails', async () => {
    renderTable({
      [LIST]: () => ({ status: 500, data: errorBody('Something went wrong', 'INTERNAL_ERROR') }),
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('That did not load');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('toggles the sort direction on a repeated header press', async () => {
    const user = userEvent.setup();
    const mock = renderTable();
    await screen.findByText('Stripe');

    await user.click(screen.getByRole('button', { name: 'Sort by Company' }));
    await waitFor(() => {
      const calls = mock.callsTo('GET', '/applications');
      expect(calls[calls.length - 1].params).toMatchObject({ sort: 'company:asc' });
    });

    await user.click(screen.getByRole('button', { name: 'Sort by Company' }));
    await waitFor(() => {
      const calls = mock.callsTo('GET', '/applications');
      expect(calls[calls.length - 1].params).toMatchObject({ sort: 'company:desc' });
    });
  });

  it('sends the selected ids to the bulk endpoint', async () => {
    const user = userEvent.setup();
    const mock = renderTable({
      'POST /applications/bulk': () => ({
        status: 200,
        data: { success: true, data: { matched: 2, modified: 2, notFound: [] } },
      }),
    });
    await screen.findByText('Stripe');

    await user.click(screen.getByLabelText('Select Stripe'));
    await user.click(screen.getByLabelText('Select Figma'));

    const bar = screen.getByRole('region', { name: 'Bulk actions' });
    expect(bar).toHaveTextContent('2 selected');

    await user.click(within(bar).getByRole('button', { name: /Archive/ }));

    await waitFor(() => {
      expect(mock.callsTo('POST', '/applications/bulk')).toHaveLength(1);
    });
    expect(mock.callsTo('POST', '/applications/bulk')[0].data).toEqual({
      ids: ['app-1', 'app-2'],
      action: 'archive',
    });
  });

  it('confirms before a bulk delete', async () => {
    const user = userEvent.setup();
    const mock = renderTable({
      'POST /applications/bulk': () => ({
        status: 200,
        data: { success: true, data: { matched: 1, modified: 1, notFound: [] } },
      }),
    });
    await screen.findByText('Stripe');

    await user.click(screen.getByLabelText('Select Stripe'));
    await user.click(
      within(screen.getByRole('region', { name: 'Bulk actions' })).getByRole('button', {
        name: /Delete/,
      }),
    );

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Delete 1 applications?');
    expect(mock.callsTo('POST', '/applications/bulk')).toHaveLength(0);

    await user.click(within(dialog).getByRole('button', { name: 'Delete them' }));
    await waitFor(() => {
      expect(mock.callsTo('POST', '/applications/bulk')[0].data).toMatchObject({
        action: 'delete',
      });
    });
  });

  it('persists hidden columns to localStorage', async () => {
    const user = userEvent.setup();
    renderTable();
    await screen.findByText('Stripe');

    await user.click(screen.getByRole('button', { name: /Columns/ }));
    await user.click(await screen.findByLabelText('Role'));

    await waitFor(() => {
      const stored: unknown = JSON.parse(window.localStorage.getItem(COLUMN_STORAGE_KEY) ?? '[]');
      expect(stored).toContain('role');
    });
    expect(screen.queryByRole('columnheader', { name: /Sort by Role/ })).not.toBeInTheDocument();
  });

  it('keeps the locked columns switchable off', async () => {
    const user = userEvent.setup();
    renderTable();
    await screen.findByText('Stripe');

    await user.click(screen.getByRole('button', { name: /Columns/ }));

    expect(await screen.findByLabelText('Company')).toBeDisabled();
    expect(screen.getByLabelText('Status')).toBeDisabled();
  });
});
