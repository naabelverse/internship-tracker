import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { QueryClient } from '@tanstack/react-query';
import { App } from '@/App';
import { queryKeys } from '@/api/queryKeys';
import { errorBody, makeApplication, makeListResponse, makeSession } from '../utils/factories';
import { columnCentre, mockBoardLayout, pointerDrag } from '../utils/dnd';
import { createGate, installMockApi, type MockApi, type Responder } from '../utils/mockAdapter';
import {
  createTestQueryClient,
  renderWithProviders,
  resetClientState,
  signIn,
} from '../utils/render';

/**
 * Regression cover for a data-loss defect found by the first real CI run.
 *
 * `BoardPage` renders the board only while its query holds data. An optimistic
 * write cancels every application query and its rollback restores them, which
 * leaves that query briefly with none — the skeleton replaces the board and the
 * subtree is destroyed and rebuilt. The version-conflict dialog used to live
 * inside that subtree, so a drag that hit a 409 could have its prompt vanish
 * before the user answered it, and the pending drop died with it: choosing
 * "Overwrite with my changes" then silently did nothing.
 *
 * The original failure surfaced as a roughly one-in-three CI flake, which is no
 * basis for a regression test. These cases construct the state instead: the
 * query is emptied on purpose while the dialog is open, and the refetch that
 * follows is held by a gate, so the window in which the board is unmounted lasts
 * exactly as long as the test wants and never depends on scheduling.
 */

const LIST = 'GET /applications';
const PATCH = 'PATCH /applications/app-1';

let restoreLayout: () => void;
let queryClient: QueryClient;
let stored = makeApplication({ id: 'app-1', company: 'Stripe', status: 'applied', version: 3 });

/** The document the server says won, echoed back in the 409 body. */
const serverCopy = makeApplication({
  id: 'app-1',
  company: 'Stripe',
  role: 'Platform Engineer Intern',
  status: 'rejected',
  version: 9,
});

const conflictReply = (): { status: number; data: unknown } => ({
  status: 409,
  data: {
    ...errorBody('This application was changed somewhere else.', 'VERSION_CONFLICT'),
    errors: { current: serverCopy, conflictSource: 'stale_read' },
  },
});

function renderBoard(routes: Record<string, Responder> = {}): MockApi {
  const mock = installMockApi({
    [LIST]: () => ({ status: 200, data: makeListResponse([stored]) }),
    ...routes,
  });
  signIn(makeSession());
  renderWithProviders(<App />, { route: '/applications/board', queryClient });

  return mock;
}

const moveHandle = (): HTMLElement => screen.getByRole('button', { name: /^Move Stripe/ });

const openPrompt = (): Promise<HTMLElement> =>
  screen.findByRole('dialog', { name: 'This was changed elsewhere' });

/**
 * Puts the board's query back to having no data at all, which is the state the
 * optimistic write and its rollback were observed to leave behind: `isPending`
 * flips back to true and `BoardPage` swaps the board for its skeleton.
 *
 * `resetQueries` rather than `removeQueries`: removing a query that still has a
 * mounted observer drops the cache entry but leaves that observer rendering its
 * last result, so the component never reaches its loading branch and the
 * reproduction would quietly test nothing. Resetting clears the data and
 * refetches, which the gated list responder then holds open.
 */
function emptyTheBoardQuery(): void {
  act(() => {
    void queryClient.resetQueries({ queryKey: queryKeys.applications.lists() });
  });
}

/** A list responder whose first load resolves and whose refetches hang on `gate`. */
function gatedList(gate: { wait: Promise<void> }): Responder {
  let calls = 0;

  return async () => {
    calls += 1;
    if (calls > 1) await gate.wait;
    return { status: 200, data: makeListResponse([stored]) };
  };
}

/** 409 on the first attempt, accepted on the retry, as an overwrite would be. */
function conflictThenAccept(): Responder {
  let calls = 0;

  return () => {
    calls += 1;
    if (calls === 1) return conflictReply();

    stored = { ...stored, status: 'interview', version: 10 };
    return { status: 200, data: { success: true, data: { application: stored } } };
  };
}

beforeEach(() => {
  stored = makeApplication({ id: 'app-1', company: 'Stripe', status: 'applied', version: 3 });
  queryClient = createTestQueryClient();
  restoreLayout = mockBoardLayout();
  resetClientState();
});

afterEach(() => {
  restoreLayout();
  resetClientState();
});

describe('version conflict dialog surviving a board remount', () => {
  it('stays open, with the conflicting document, while the board is unmounted', async () => {
    const refetch = createGate();
    renderBoard({ [LIST]: gatedList(refetch), [PATCH]: conflictReply });

    await screen.findByText('Stripe');
    // 'interview' is the fourth status, so column index 3.
    await pointerDrag(moveHandle(), columnCentre(3));
    await openPrompt();

    emptyTheBoardQuery();

    // Proves the reproduction actually bit. Without this the test could pass
    // while never unmounting anything.
    await screen.findByTestId('board-skeleton');
    expect(screen.queryByTestId('kanban-board')).not.toBeInTheDocument();

    const prompt = await openPrompt();
    const current = within(prompt).getByTestId('conflict-current');
    expect(current).toHaveTextContent('Platform Engineer Intern');
    expect(current).toHaveTextContent('Rejected');
    expect(current).toHaveTextContent('9');

    refetch.open();
    await screen.findByTestId('kanban-board');
    expect(await openPrompt()).toBeInTheDocument();
  });

  it('still sends the original pending move when overwrite is chosen after a remount', async () => {
    const refetch = createGate();
    const mock = renderBoard({ [LIST]: gatedList(refetch), [PATCH]: conflictThenAccept() });

    await screen.findByText('Stripe');
    await pointerDrag(moveHandle(), columnCentre(3));
    await openPrompt();

    emptyTheBoardQuery();
    await screen.findByTestId('board-skeleton');

    refetch.open();
    await screen.findByTestId('kanban-board');

    const prompt = await openPrompt();
    await userEvent.click(
      within(prompt).getByRole('button', { name: 'Overwrite with my changes' }),
    );

    await waitFor(() => {
      expect(mock.callsTo('PATCH', '/applications/app-1')).toHaveLength(2);
    });

    // The move the user actually made, resent without a version — not a default,
    // not the server's status, and not silently nothing.
    const second = mock.callsTo('PATCH', '/applications/app-1')[1].data as Record<string, unknown>;
    expect(second).toEqual({ status: 'interview' });
  });

  it('keeps the prompt answerable while the board is still unmounted', async () => {
    const refetch = createGate();
    const mock = renderBoard({ [LIST]: gatedList(refetch), [PATCH]: conflictThenAccept() });

    await screen.findByText('Stripe');
    await pointerDrag(moveHandle(), columnCentre(3));
    await openPrompt();

    emptyTheBoardQuery();
    await screen.findByTestId('board-skeleton');

    // Answered with the board still gone, which is the worst case: the dialog
    // has outlived the subtree it used to belong to.
    const prompt = await openPrompt();
    await userEvent.click(
      within(prompt).getByRole('button', { name: 'Overwrite with my changes' }),
    );

    await waitFor(() => {
      expect(mock.callsTo('PATCH', '/applications/app-1')).toHaveLength(2);
    });
    expect(mock.callsTo('PATCH', '/applications/app-1')[1].data).toEqual({ status: 'interview' });

    // Let the held refetch land and the board come back before the case ends,
    // so nothing resolves into a torn-down tree and leaks into the next test.
    refetch.open();
    await screen.findByTestId('kanban-board');
  });
});
