import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { App } from '@/App';
import { makeApplication, makeListResponse, makeSession } from '../utils/factories';
import { installMockApi } from '../utils/mockAdapter';
import { renderWithProviders, resetClientState, signIn, waitForRoute } from '../utils/render';

/**
 * The Move button is the card's only drag handle, so the page says so and the
 * button wears a grip mark. The mark is decoration: the button keeps the
 * accessible name it always had, and dnd-kit's own description still carries
 * the keyboard instructions the old subtitle used to spell out.
 */
async function renderBoard(): Promise<void> {
  installMockApi({
    'GET /applications': () => ({
      status: 200,
      data: makeListResponse([makeApplication({ id: 'a1', company: 'Stripe', status: 'applied' })]),
    }),
  });
  signIn(makeSession());
  renderWithProviders(<App />, { route: '/applications/board' });
  await waitForRoute();
}

beforeEach(() => {
  resetClientState();
});

afterEach(() => {
  resetClientState();
});

describe('board move handle', () => {
  it('tells the user to drag by the Move bar', async () => {
    await renderBoard();

    expect(
      await screen.findByText('Drag a card by its Move bar to move it between columns.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/focus one and press space/i)).not.toBeInTheDocument();
  });

  it('shows a grip icon hidden from assistive technology, keeping the name and label', async () => {
    await renderBoard();

    const handle = await screen.findByRole('button', { name: 'Move Stripe from Applied' });
    const icon = handle.querySelector('svg');

    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute('aria-hidden', 'true');
    expect(icon).toHaveAttribute('focusable', 'false');
    expect(handle).toHaveTextContent(/^Move$/);
  });

  it('keeps the keyboard instructions in the description screen readers get', async () => {
    await renderBoard();

    const handle = await screen.findByRole('button', { name: 'Move Stripe from Applied' });

    expect(handle).toHaveAccessibleDescription(/press the space bar/i);
  });
});
