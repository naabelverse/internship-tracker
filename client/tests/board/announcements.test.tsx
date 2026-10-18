import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '@/App';
import { makeApplication, makeListResponse, makeSession } from '../utils/factories';
import { mockBoardLayout } from '../utils/dnd';
import { installMockApi } from '../utils/mockAdapter';
import { renderWithProviders, resetClientState, signIn } from '../utils/render';

/**
 * Issue #90: dnd-kit's default announcements read the card's database id and
 * the raw status key ("Draggable item 6ac648aa… was moved over droppable area
 * withdrawn"). The board now names the company and the column's label.
 */

let restoreLayout: () => void;

beforeEach(() => {
  restoreLayout = mockBoardLayout();
  resetClientState();
  installMockApi({
    'GET /applications': () => ({
      status: 200,
      data: makeListResponse([
        makeApplication({ id: '6ac648aa14f934e3f35eb04e', company: 'Shopee', status: 'saved' }),
      ]),
    }),
  });
  signIn(makeSession());
});

afterEach(() => {
  restoreLayout();
  resetClientState();
});

function liveRegion(): HTMLElement {
  const region = document.querySelector<HTMLElement>('[id^="DndLiveRegion"]');
  if (!region) throw new Error('dnd-kit live region is missing');
  return region;
}

async function pickUp() {
  const user = userEvent.setup();
  renderWithProviders(<App />, { route: '/applications/board' });
  const handle = await screen.findByRole('button', { name: 'Move Shopee from Saved' });
  handle.focus();
  await user.keyboard(' ');
  await waitFor(() => {
    expect(liveRegion()).toHaveTextContent('Picked up Shopee, in Saved.');
  });

  return user;
}

describe('board drag announcements', () => {
  it('names the company and the column while a card moves', async () => {
    const user = await pickUp();

    await user.keyboard('{ArrowRight}');

    await waitFor(() => {
      expect(liveRegion()).toHaveTextContent('Shopee is over Applied.');
    });
    expect(liveRegion().textContent).not.toMatch(/6ac648aa|droppable|draggable/i);
  });

  it('says where a keyboard drop landed', async () => {
    const user = await pickUp();

    await user.keyboard('{ArrowRight}');
    await user.keyboard(' ');

    await waitFor(() => {
      expect(liveRegion()).toHaveTextContent('Shopee dropped in Applied.');
    });
  });

  it('says a cancelled move left the card where it was', async () => {
    const user = await pickUp();

    await user.keyboard('{ArrowRight}');
    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(liveRegion()).toHaveTextContent('Move cancelled. Shopee is back in Saved.');
    });
  });
});
