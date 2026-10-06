import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '@/App';
import { makeApplication, makeListResponse, makeSession } from '../utils/factories';
import { installMockApi } from '../utils/mockAdapter';
import { renderWithProviders, resetClientState, signIn } from '../utils/render';

/**
 * The toolbar's search field: its icon, its clear button and its name. jsdom
 * paints nothing, so the icon is held by where it sits in the DOM: inside the
 * field's own box and after the input, which is what puts it above the input's
 * background. Before, it sat before the field's box and was painted under it.
 * Alignment with the buttons and the hidden native clear button are geometry,
 * and live in `e2e/audits/searchField.spec.ts`.
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

async function renderSearch() {
  const user = userEvent.setup();
  renderWithProviders(<App />, { route: '/applications' });
  await screen.findByText('Stripe');

  return { user, field: screen.getByRole('searchbox', { name: 'Search applications' }) };
}

describe('the applications search field', () => {
  it('draws its search icon inside the field, after the input', async () => {
    const { field } = await renderSearch();

    const icon = field.parentElement?.querySelector('svg');

    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute('aria-hidden', 'true');
    expect(field.compareDocumentPosition(icon as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it('shows a clear button only while there is text, and clicking it clears and refocuses', async () => {
    const { user, field } = await renderSearch();

    expect(screen.queryByRole('button', { name: 'Clear search' })).not.toBeInTheDocument();

    await user.type(field, 'stri');
    await user.click(screen.getByRole('button', { name: 'Clear search' }));

    expect(field).toHaveValue('');
    expect(field).toHaveFocus();
    expect(screen.queryByRole('button', { name: 'Clear search' })).not.toBeInTheDocument();
  });

  it('is reached by Tab after the field, and Enter or Space clears it', async () => {
    const { user, field } = await renderSearch();

    for (const key of ['{Enter}', ' ']) {
      await user.type(field, 'stri');
      await user.tab();
      expect(screen.getByRole('button', { name: 'Clear search' })).toHaveFocus();

      await user.keyboard(key);

      expect(field).toHaveValue('');
      expect(field).toHaveFocus();
    }
  });

  it('keeps its name while the clear button is showing, and names everything it searches', async () => {
    const { user, field } = await renderSearch();

    await user.type(field, 'stri');

    expect(screen.getByRole('searchbox', { name: 'Search applications' })).toBe(field);
    expect(screen.getByRole('button', { name: 'Clear search' })).toBeInTheDocument();
    expect(field).toHaveAttribute('placeholder', 'Search company, role, tags or notes');
  });
});
