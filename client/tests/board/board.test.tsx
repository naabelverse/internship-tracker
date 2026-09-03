import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { App } from '@/App';
import { BOARD_LIMIT } from '@/features/board/boardColumns';
import { errorBody, makeApplication, makeListResponse, makeSession } from '../utils/factories';
import { installMockApi, type Responder } from '../utils/mockAdapter';
import { renderWithProviders, resetClientState, signIn } from '../utils/render';

const LIST = 'GET /applications';

const rows = [
  makeApplication({ id: 'a1', company: 'Stripe', status: 'applied', priority: 'high' }),
  makeApplication({ id: 'a2', company: 'Figma', status: 'applied' }),
  makeApplication({ id: 'a3', company: 'Linear', status: 'offer', tags: ['design', 'remote'] }),
];

function renderBoard(routes: Record<string, Responder> = {}, meta = {}): void {
  installMockApi({
    [LIST]: () => ({ status: 200, data: makeListResponse(rows, meta) }),
    ...routes,
  });
  signIn(makeSession());
  renderWithProviders(<App />, { route: '/applications/board' });
}

beforeEach(() => {
  resetClientState();
});

afterEach(() => {
  resetClientState();
});

describe('board rendering', () => {
  it('shows a skeleton before the first page arrives', () => {
    installMockApi({ [LIST]: () => ({ status: 200, data: makeListResponse([]) }) });
    signIn(makeSession());

    renderWithProviders(<App />, { route: '/applications/board' });

    expect(screen.getByTestId('board-skeleton')).toBeInTheDocument();
  });

  it('shows an error state with a retry when the board fails to load', async () => {
    renderBoard({
      [LIST]: () => ({ status: 500, data: errorBody('Something went wrong', 'INTERNAL_ERROR') }),
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('That did not load');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('shows an empty state when nothing is tracked yet', async () => {
    renderBoard({ [LIST]: () => ({ status: 200, data: makeListResponse([]) }) });

    expect(await screen.findByText('Nothing on the board yet')).toBeInTheDocument();
  });

  it('renders one column per status with a live count', async () => {
    renderBoard();
    await screen.findByText('Stripe');

    expect(screen.getAllByTestId(/^column-/)).toHaveLength(8);

    const applied = screen.getByTestId('column-applied');
    expect(within(applied).getByRole('heading', { level: 2 })).toHaveTextContent('Applied');
    expect(applied).toHaveAccessibleName('Applied, 2 applications');
    expect(screen.getByTestId('column-offer')).toHaveAccessibleName('Offer, 1 applications');
    expect(screen.getByTestId('column-saved')).toHaveAccessibleName('Saved, 0 applications');
  });

  it('puts each card in the column for its status', async () => {
    renderBoard();
    await screen.findByText('Stripe');

    expect(within(screen.getByTestId('column-applied')).getByText('Figma')).toBeInTheDocument();
    expect(within(screen.getByTestId('column-offer')).getByText('Linear')).toBeInTheDocument();
  });

  it('shows the role, deadline chip and tags on a card', async () => {
    renderBoard();
    await screen.findByText('Linear');

    const card = screen.getByTestId('column-offer');
    expect(within(card).getByText('Backend Intern')).toBeInTheDocument();
    expect(within(card).getByText('design')).toBeInTheDocument();
    expect(within(card).getByText('remote')).toBeInTheDocument();
  });

  it('gives every card a labelled move handle for the keyboard sensor', async () => {
    renderBoard();
    await screen.findByText('Stripe');

    expect(screen.getByRole('button', { name: 'Move Stripe from Applied' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move Linear from Offer' })).toBeInTheDocument();
  });

  it('says so when there are more applications than one board page holds', async () => {
    renderBoard({}, { total: BOARD_LIMIT + 40 });

    expect(await screen.findByRole('status')).toHaveTextContent(
      `Showing the ${String(BOARD_LIMIT)} most recently updated of ${String(BOARD_LIMIT + 40)}`,
    );
  });
});
