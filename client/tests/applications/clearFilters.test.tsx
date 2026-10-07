import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '@/App';
import { makeApplication, makeListResponse, makeSession } from '../utils/factories';
import { installMockApi } from '../utils/mockAdapter';
import { renderWithProviders, resetClientState, signIn } from '../utils/render';

/**
 * The toolbar's "Clear filters": when it shows, where it sits and where focus
 * goes once it has cleared. Every list request returns a row, so the empty
 * state's own "Clear filters" never renders and each query here can only find
 * the toolbar's.
 */

beforeEach(() => {
  resetClientState();
  installMockApi({
    'GET /applications': () => ({
      status: 200,
      data: makeListResponse([makeApplication({ company: 'Stripe', role: 'Backend Intern' })]),
    }),
  });
  signIn(makeSession());
});

afterEach(() => {
  resetClientState();
});

async function renderToolbar(query: string) {
  const user = userEvent.setup();
  renderWithProviders(<App />, { route: `/applications${query}` });
  await screen.findByText('Stripe');

  return user;
}

const clearButton = () => screen.queryByRole('button', { name: 'Clear filters' });
const filtersButton = () => screen.getByRole('button', { name: /^Filters/ });

describe('the toolbar Clear filters button', () => {
  it('stays hidden for search text alone, which the field clears itself', async () => {
    await renderToolbar('?search=stri');

    expect(screen.getByRole('button', { name: 'Clear search' })).toBeInTheDocument();
    expect(clearButton()).not.toBeInTheDocument();
  });

  it.each([
    ['a status', '?status=applied'],
    ['Show archived', '?archived=true'],
    ['a filter only a link can set', '?tags=remote'],
  ])('shows for %s', async (_name, query) => {
    await renderToolbar(query);

    expect(clearButton()).toBeInTheDocument();
  });

  it('sits right after Filters, in the DOM and in the tab order', async () => {
    const user = await renderToolbar('?status=applied');
    const buttons = screen.getAllByRole('button');

    expect(buttons.indexOf(clearButton() as HTMLElement)).toBe(
      buttons.indexOf(filtersButton()) + 1,
    );

    await user.click(screen.getByRole('searchbox', { name: 'Search applications' }));
    await user.tab();
    expect(filtersButton()).toHaveFocus();
    await user.tab();
    expect(clearButton()).toHaveFocus();
  });

  it.each([
    ['Enter', '{Enter}'],
    ['Space', ' '],
  ])('clears filters and search together on %s and leaves focus on Filters', async (_key, keys) => {
    const user = await renderToolbar('?status=applied&search=stri');
    const searchbox = screen.getByRole('searchbox', { name: 'Search applications' });
    expect(searchbox).toHaveValue('stri');

    (clearButton() as HTMLElement).focus();
    await user.keyboard(keys);

    await waitFor(() => {
      expect(clearButton()).not.toBeInTheDocument();
    });
    expect(searchbox).toHaveValue('');
    expect(filtersButton()).toHaveAccessibleName('Filters');
    expect(filtersButton()).toHaveFocus();
  });
});
