import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '@/App';
import { COLUMN_STORAGE_KEY } from '@/features/applications/columns';
import { makeApplication, makeListResponse, makeSession } from '../utils/factories';
import { installMockApi, type MockApi } from '../utils/mockAdapter';
import { renderWithProviders, resetClientState, signIn } from '../utils/render';

/**
 * Export CSV as a two-choice menu. "Shown columns" sends the table's visible
 * column ids, read from the same stored choice the table renders from; "All
 * fields" sends the original request with no column list. The menu is driven
 * from the keyboard the way a menu button is expected to be.
 */

const EXPORT_URL = '/applications/export';
const DEFAULT_SHOWN = 'company,role,status,priority,appliedDate,deadline,tags';

function render(hiddenColumns?: string[]): MockApi {
  if (hiddenColumns) {
    window.localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify(hiddenColumns));
  }
  const api = installMockApi({
    'GET /applications': () => ({
      status: 200,
      data: makeListResponse([makeApplication({ company: 'Stripe', role: 'Backend Intern' })]),
    }),
    [`GET ${EXPORT_URL}`]: () => ({ status: 200, data: new Blob(['company,status\n']) }),
  });
  signIn(makeSession());
  renderWithProviders(<App />, { route: '/applications' });

  return api;
}

async function exportParams(api: MockApi): Promise<Record<string, string> | undefined> {
  await waitFor(() => {
    expect(api.callsTo('GET', EXPORT_URL)).toHaveLength(1);
  });
  return api.callsTo('GET', EXPORT_URL)[0]?.params;
}

beforeEach(() => {
  resetClientState();
  // jsdom implements neither object URLs nor a download.
  URL.createObjectURL = vi.fn(() => 'blob:mock/1');
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  resetClientState();
});

describe('the Export CSV menu', () => {
  it('sends exactly the default visible columns for "Shown columns"', async () => {
    const user = userEvent.setup();
    const api = render();

    await user.click(await screen.findByRole('button', { name: 'Export CSV' }));
    await user.click(screen.getByRole('menuitem', { name: 'Shown columns (7)' }));

    expect(await exportParams(api)).toEqual({ format: 'csv', columns: DEFAULT_SHOWN });
  });

  it('still offers "Shown columns (2)" when only the locked Company and Status are on', async () => {
    const user = userEvent.setup();
    const api = render([
      'role',
      'priority',
      'source',
      'location',
      'appliedDate',
      'deadline',
      'tags',
    ]);

    await user.click(await screen.findByRole('button', { name: 'Export CSV' }));
    const shown = screen.getByRole('menuitem', { name: 'Shown columns (2)' });
    expect(shown).toBeEnabled();
    await user.click(shown);

    expect(await exportParams(api)).toEqual({ format: 'csv', columns: 'company,status' });
  });

  it('follows the Columns menu, so a column switched on is sent too', async () => {
    const user = userEvent.setup();
    const api = render();

    await user.click(await screen.findByRole('button', { name: /^Columns/ }));
    await user.click(screen.getByRole('checkbox', { name: 'Source' }));
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Export CSV' }));
    await user.click(screen.getByRole('menuitem', { name: 'Shown columns (8)' }));

    expect(await exportParams(api)).toEqual({
      format: 'csv',
      columns: 'company,role,status,priority,source,appliedDate,deadline,tags',
    });
  });

  it('sends no column list for "All fields"', async () => {
    const user = userEvent.setup();
    const api = render([
      'role',
      'priority',
      'source',
      'location',
      'appliedDate',
      'deadline',
      'tags',
    ]);

    await user.click(await screen.findByRole('button', { name: 'Export CSV' }));
    await user.click(screen.getByRole('menuitem', { name: 'All fields' }));

    const params = await exportParams(api);
    expect(params).toEqual({ format: 'csv' });
    expect(params).not.toHaveProperty('columns');
  });

  it('is announced as a menu, and each choice has a name and a description', async () => {
    const user = userEvent.setup();
    render();
    const trigger = await screen.findByRole('button', { name: 'Export CSV' });

    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    await user.click(trigger);

    expect(screen.getByRole('menu', { name: 'Export CSV' })).toBeInTheDocument();
    // The list holds one row, and both choices carry what the list shows (#83).
    expect(screen.getByRole('menuitem', { name: 'Shown columns (7)' })).toHaveAccessibleDescription(
      '1 application, as listed. The columns in the table. May not import again if Role is hidden.',
    );
    expect(screen.getByRole('menuitem', { name: 'All fields' })).toHaveAccessibleDescription(
      '1 application, as listed. Every field. Can be imported again.',
    );
  });

  // Issue #83: the request carries the view's search, filters, archived and
  // sort, and never its paging, so the file is every row the view holds.
  it('sends the current view without its page', async () => {
    const user = userEvent.setup();
    const api = installMockApi({
      'GET /applications': () => ({ status: 200, data: makeListResponse([makeApplication()]) }),
      [`GET ${EXPORT_URL}`]: () => ({ status: 200, data: new Blob(['company\n']) }),
    });
    signIn(makeSession());
    renderWithProviders(<App />, {
      route: '/applications?search=intern&status=applied&archived=true&sort=company:asc&page=2',
    });

    await user.click(await screen.findByRole('button', { name: 'Export CSV' }));
    await user.click(screen.getByRole('menuitem', { name: 'All fields' }));

    expect(await exportParams(api)).toEqual({
      format: 'csv',
      search: 'intern',
      status: 'applied',
      archived: 'true',
      sort: 'company:asc',
    });
  });

  it('opens with Enter, moves with the arrows, Home and End, and selects with Enter', async () => {
    const user = userEvent.setup();
    const api = render();
    const trigger = await screen.findByRole('button', { name: 'Export CSV' });
    trigger.focus();

    await user.keyboard('{Enter}');
    const shown = screen.getByRole('menuitem', { name: 'Shown columns (7)' });
    const all = screen.getByRole('menuitem', { name: 'All fields' });
    expect(shown).toHaveFocus();

    await user.keyboard('{ArrowDown}');
    expect(all).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(shown).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(all).toHaveFocus();
    await user.keyboard('{Home}');
    expect(shown).toHaveFocus();
    await user.keyboard('{End}');
    expect(all).toHaveFocus();

    await user.keyboard('{Enter}');

    expect(await exportParams(api)).toEqual({ format: 'csv' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('opens with Space and selects the focused choice with Enter', async () => {
    const user = userEvent.setup();
    const api = render();
    const trigger = await screen.findByRole('button', { name: 'Export CSV' });
    trigger.focus();

    await user.keyboard(' ');
    expect(screen.getByRole('menuitem', { name: 'Shown columns (7)' })).toHaveFocus();
    await user.keyboard('{Enter}');

    expect(await exportParams(api)).toEqual({ format: 'csv', columns: DEFAULT_SHOWN });
  });

  it('closes on Escape, returns focus to the trigger and downloads nothing', async () => {
    const user = userEvent.setup();
    const api = render();
    const trigger = await screen.findByRole('button', { name: 'Export CSV' });
    trigger.focus();

    await user.keyboard('{Enter}');
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(api.callsTo('GET', EXPORT_URL)).toHaveLength(0);
  });
});
