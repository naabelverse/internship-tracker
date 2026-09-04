import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '@/App';
import { errorBody, makeApplication, makeListResponse, makeSession } from '../utils/factories';
import { columnCentre, mockBoardLayout, pointerDrag } from '../utils/dnd';
import { createGate, installMockApi, type MockApi, type Responder } from '../utils/mockAdapter';
import { renderWithProviders, resetClientState, signIn } from '../utils/render';

const LIST = 'GET /applications';
const PATCH = 'PATCH /applications/app-1';

let restoreLayout: () => void;
let stored = makeApplication({ id: 'app-1', company: 'Stripe', status: 'applied', version: 3 });

function renderBoard(routes: Record<string, Responder> = {}): MockApi {
  const mock = installMockApi({
    [LIST]: () => ({ status: 200, data: makeListResponse([stored]) }),
    ...routes,
  });
  signIn(makeSession());
  renderWithProviders(<App />, { route: '/applications/board' });

  return mock;
}

function moveHandle(): HTMLElement {
  return screen.getByRole('button', { name: /^Move Stripe/ });
}

function columnOf(status: string): HTMLElement {
  return screen.getByTestId(`column-${status}`);
}

beforeEach(() => {
  stored = makeApplication({ id: 'app-1', company: 'Stripe', status: 'applied', version: 3 });
  restoreLayout = mockBoardLayout();
  resetClientState();
});

afterEach(() => {
  restoreLayout();
  resetClientState();
});

describe('pointer drag', () => {
  it('sends the destination status and the version the card was rendered with', async () => {
    const mock = renderBoard({
      [PATCH]: () => {
        stored = { ...stored, status: 'interview', version: 4 };
        return { status: 200, data: { success: true, data: { application: stored } } };
      },
    });

    await screen.findByText('Stripe');
    // 'interview' is the fourth status, so column index 3.
    await pointerDrag(moveHandle(), columnCentre(3));

    await waitFor(() => {
      expect(mock.callsTo('PATCH', '/applications/app-1')).toHaveLength(1);
    });

    expect(mock.callsTo('PATCH', '/applications/app-1')[0].data).toEqual({
      status: 'interview',
      version: 3,
    });
  });
});

describe('drag rollback', () => {
  it('shows the card in the destination column, then snaps it back when the drop fails', async () => {
    const gate = createGate();
    renderBoard({
      [PATCH]: async () => {
        await gate.wait;
        return { status: 500, data: errorBody('Something went wrong', 'INTERNAL_ERROR') };
      },
    });

    await screen.findByText('Stripe');
    expect(within(columnOf('applied')).getByText('Stripe')).toBeInTheDocument();

    await pointerDrag(moveHandle(), columnCentre(3));

    // Optimistic: the card is in the drop column while the request is in flight.
    await waitFor(() => {
      expect(within(columnOf('interview')).getByText('Stripe')).toBeInTheDocument();
    });

    gate.open();

    // The snapshot taken in onMutate returns it to where it came from.
    await waitFor(() => {
      expect(within(columnOf('applied')).getByText('Stripe')).toBeInTheDocument();
    });
    expect(within(columnOf('interview')).queryByText('Stripe')).not.toBeInTheDocument();
  });

  it('keeps the card in the destination column when the drop succeeds', async () => {
    renderBoard({
      [PATCH]: () => {
        stored = { ...stored, status: 'offer', version: 4 };
        return { status: 200, data: { success: true, data: { application: stored } } };
      },
    });

    await screen.findByText('Stripe');
    await pointerDrag(moveHandle(), columnCentre(4));

    await waitFor(() => {
      expect(within(columnOf('offer')).getByText('Stripe')).toBeInTheDocument();
    });
  });

  it('sends nothing when a card is dropped back on its own column', async () => {
    const mock = renderBoard();

    await screen.findByText('Stripe');
    await pointerDrag(moveHandle(), columnCentre(1));

    await waitFor(() => {
      expect(within(columnOf('applied')).getByText('Stripe')).toBeInTheDocument();
    });
    expect(mock.callsTo('PATCH', '/applications/app-1')).toHaveLength(0);
  });
});

describe('drag into a version conflict', () => {
  const theirs = makeApplication({
    id: 'app-1',
    company: 'Stripe',
    role: 'Platform Engineer Intern',
    status: 'rejected',
    version: 9,
  });

  const conflict: Responder = () => ({
    status: 409,
    data: {
      success: false,
      message: 'This application was changed somewhere else. Reload to see the latest version.',
      code: 'VERSION_CONFLICT',
      errors: { current: theirs, conflictSource: 'stale_read' },
    },
  });

  it('opens the conflict dialog with the drag card, not a generic toast', async () => {
    const gate = createGate();
    renderBoard({
      [PATCH]: async (request) => {
        await gate.wait;
        return conflict(request);
      },
    });

    await screen.findByText('Stripe');
    await pointerDrag(moveHandle(), columnCentre(3));

    await waitFor(() => {
      expect(within(columnOf('interview')).getByText('Stripe')).toBeInTheDocument();
    });

    gate.open();

    const prompt = await screen.findByRole('dialog', { name: 'This was changed elsewhere' });
    const current = within(prompt).getByTestId('conflict-current');
    expect(current).toHaveTextContent('Platform Engineer Intern');
    expect(current).toHaveTextContent('Rejected');
    expect(current).toHaveTextContent('9');
  });

  it('leaves the card in its origin column while the prompt is open', async () => {
    renderBoard({ [PATCH]: conflict });

    await screen.findByText('Stripe');
    await pointerDrag(moveHandle(), columnCentre(3));

    await screen.findByRole('dialog', { name: 'This was changed elsewhere' });

    expect(within(columnOf('applied')).getByText('Stripe')).toBeInTheDocument();
    expect(within(columnOf('interview')).queryByText('Stripe')).not.toBeInTheDocument();
  });

  it('retries the same move without a version when the user overwrites', async () => {
    let attempts = 0;
    const mock = renderBoard({
      [PATCH]: (request) => {
        attempts += 1;
        if (attempts === 1) return conflict(request);

        stored = { ...stored, status: 'interview', version: 10 };
        return { status: 200, data: { success: true, data: { application: stored } } };
      },
    });

    await screen.findByText('Stripe');
    await pointerDrag(moveHandle(), columnCentre(3));

    const prompt = await screen.findByRole('dialog', { name: 'This was changed elsewhere' });
    await userEvent.click(
      within(prompt).getByRole('button', { name: 'Overwrite with my changes' }),
    );

    await waitFor(() => {
      expect(mock.callsTo('PATCH', '/applications/app-1')).toHaveLength(2);
    });

    const second = mock.callsTo('PATCH', '/applications/app-1')[1].data as Record<string, unknown>;
    expect(second).toEqual({ status: 'interview' });
  });
});

describe('keyboard drag', () => {
  it('picks up, moves and drops with the keyboard alone, firing the same PATCH', async () => {
    const user = userEvent.setup();
    const mock = renderBoard({
      [PATCH]: () => {
        stored = { ...stored, status: 'interview', version: 4 };
        return { status: 200, data: { success: true, data: { application: stored } } };
      },
    });

    await screen.findByText('Stripe');

    moveHandle().focus();
    expect(moveHandle()).toHaveFocus();

    // Space picks the card up, each arrow steps one column, space drops it.
    await user.keyboard(' ');
    await user.keyboard('{ArrowRight}');
    await user.keyboard('{ArrowRight}');
    await user.keyboard(' ');

    await waitFor(() => {
      expect(mock.callsTo('PATCH', '/applications/app-1')).toHaveLength(1);
    });

    expect(mock.callsTo('PATCH', '/applications/app-1')[0].data).toEqual({
      status: 'interview',
      version: 3,
    });
    await waitFor(() => {
      expect(within(columnOf('interview')).getByText('Stripe')).toBeInTheDocument();
    });
  });

  it('rolls back a keyboard move the server rejects', async () => {
    const user = userEvent.setup();
    const gate = createGate();
    renderBoard({
      [PATCH]: async () => {
        await gate.wait;
        return { status: 500, data: errorBody('Something went wrong', 'INTERNAL_ERROR') };
      },
    });

    await screen.findByText('Stripe');

    moveHandle().focus();
    await user.keyboard(' ');
    await user.keyboard('{ArrowRight}');
    await user.keyboard(' ');

    await waitFor(() => {
      expect(within(columnOf('assessment')).getByText('Stripe')).toBeInTheDocument();
    });

    gate.open();

    await waitFor(() => {
      expect(within(columnOf('applied')).getByText('Stripe')).toBeInTheDocument();
    });
  });
});
