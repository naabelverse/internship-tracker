import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { QueryClient } from '@tanstack/react-query';
import { App } from '@/App';
import { removeCachedApplications } from '@/features/applications/optimisticCache';
import { errorBody, makeApplication, makeListResponse, makeSession } from '../utils/factories';
import { createGate, installMockApi, type MockApi, type Responder } from '../utils/mockAdapter';
import {
  createTestQueryClient,
  renderWithProviders,
  resetClientState,
  signIn,
} from '../utils/render';

/**
 * Regression cover for the second instance of the defect the board hit.
 *
 * `ApplicationsPage` used to re-derive the edit modal's open state from the live
 * list on every render — `applications.find(...)` with `isOpen={editing !== undefined}`.
 * Any refetch that momentarily did not contain the row therefore closed the modal
 * mid-edit, and three things followed from that one cause: the modal disappeared,
 * the reset effect in `ApplicationFormModal` wiped what the user had typed when the
 * row came back, and while the row was missing `isEdit` was false, so saving took
 * the create branch and silently POSTed a duplicate instead of PATCHing the row.
 *
 * The row is removed here with `removeCachedApplications`, which is the production
 * helper an optimistic delete uses, and put back with the restore closure it
 * returns — so the reproduction is the real code path rather than a synthetic one,
 * and it never depends on scheduling. The list responder is gated as well, so no
 * refetch can refill the list before the assertions run.
 */

const LIST = 'GET /applications';
const PATCH = 'PATCH /applications/app-1';
const CREATE = 'POST /applications';

let queryClient: QueryClient;
let stored = makeApplication({
  id: 'app-1',
  company: 'Stripe',
  role: 'Backend Intern',
  status: 'applied',
  version: 3,
});

/** What another writer left on the server while this form was open. */
const serverCopy = makeApplication({
  id: 'app-1',
  company: 'Stripe',
  role: 'Platform Engineer Intern',
  status: 'interview',
  version: 7,
});

const conflictReply = (): { status: number; data: unknown } => ({
  status: 409,
  data: {
    ...errorBody('This application was changed somewhere else.', 'VERSION_CONFLICT'),
    errors: { current: serverCopy, conflictSource: 'stale_read' },
  },
});

/** A list responder whose first load resolves and whose refetches hang on `gate`. */
function gatedList(gate: { wait: Promise<void> }): Responder {
  let calls = 0;

  return async () => {
    calls += 1;
    if (calls > 1) await gate.wait;
    return { status: 200, data: makeListResponse([stored]) };
  };
}

function renderList(routes: Record<string, Responder> = {}): MockApi {
  const gate = createGate();
  const mock = installMockApi({ [LIST]: gatedList(gate), ...routes });
  signIn(makeSession());
  renderWithProviders(<App />, { route: '/applications', queryClient });

  return mock;
}

const editDialog = (): Promise<HTMLElement> =>
  screen.findByRole('dialog', { name: 'Edit application' });

const conflictDialog = (): Promise<HTMLElement> =>
  screen.findByRole('dialog', { name: 'This was changed elsewhere' });

/** Opens the edit modal and replaces the role with something the server has never seen. */
async function openEditAndType(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await screen.findByText('Stripe');
  await user.click(screen.getByRole('button', { name: 'Edit Stripe' }));

  const dialog = await editDialog();
  const role = within(dialog).getByLabelText('Role');
  await user.clear(role);
  await user.type(role, 'Distributed Systems Intern');
}

/**
 * Drops the row from every cached list, exactly as an optimistic delete does,
 * and hands back the closure that puts it back — the rollback of that same write.
 */
function dropTheRow(): () => void {
  let restore = (): void => undefined;
  act(() => {
    restore = removeCachedApplications(queryClient, ['app-1']);
  });

  return () => {
    act(() => {
      restore();
    });
  };
}

beforeEach(() => {
  stored = makeApplication({
    id: 'app-1',
    company: 'Stripe',
    role: 'Backend Intern',
    status: 'applied',
    version: 3,
  });
  queryClient = createTestQueryClient();
  resetClientState();
});

afterEach(() => {
  resetClientState();
});

describe('edit modal surviving the row leaving the list', () => {
  it('stays open with the typed values while the row is gone', async () => {
    const user = userEvent.setup();
    renderList();
    await openEditAndType(user);

    dropTheRow();

    // Proves the reproduction actually bit: the row really is out of the list.
    await waitFor(() => {
      expect(screen.queryByText('Backend Intern')).not.toBeInTheDocument();
    });

    const dialog = await editDialog();
    expect(within(dialog).getByLabelText('Role')).toHaveValue('Distributed Systems Intern');
    expect(within(dialog).getByLabelText('Company')).toHaveValue('Stripe');
  });

  it('still PATCHes the original row, with the typed values, after it returns', async () => {
    const user = userEvent.setup();
    const mock = renderList({
      [PATCH]: () => {
        stored = { ...stored, role: 'Distributed Systems Intern', version: 4 };
        return { status: 200, data: { success: true, data: { application: stored } } };
      },
    });
    await openEditAndType(user);

    const putItBack = dropTheRow();
    // The drop has to be observed before it is undone. TanStack notifies its
    // observers through a scheduler, so writing and restoring back to back would
    // coalesce into no render at all and the round trip would never happen.
    await waitFor(() => {
      expect(screen.queryByText('Backend Intern')).not.toBeInTheDocument();
    });

    putItBack();
    await screen.findByText('Backend Intern');

    const dialog = await editDialog();
    // The round trip must not have re-run the form's reset effect.
    expect(within(dialog).getByLabelText('Role')).toHaveValue('Distributed Systems Intern');

    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      expect(mock.callsTo('PATCH', '/applications/app-1')).toHaveLength(1);
    });

    const sent = mock.callsTo('PATCH', '/applications/app-1')[0].data as Record<string, unknown>;
    expect(sent.role).toBe('Distributed Systems Intern');
    // The version the user actually read, not one a refetch moved on underneath them.
    expect(sent.version).toBe(3);
    expect(mock.callsTo('POST', '/applications')).toHaveLength(0);
  });

  it('keeps the 409 prompt answerable, and overwrite still updates rather than creates', async () => {
    const user = userEvent.setup();
    let attempts = 0;
    const mock = renderList({
      [PATCH]: () => {
        attempts += 1;
        if (attempts === 1) return conflictReply();

        stored = { ...stored, role: 'Distributed Systems Intern', version: 8 };
        return { status: 200, data: { success: true, data: { application: stored } } };
      },
      [CREATE]: () => ({
        status: 201,
        data: { success: true, data: { application: makeApplication({ id: 'app-2' }) } },
      }),
    });

    await openEditAndType(user);
    await user.click(within(await editDialog()).getByRole('button', { name: 'Save changes' }));

    const prompt = await conflictDialog();
    expect(within(prompt).getByTestId('conflict-current')).toHaveTextContent(
      'Platform Engineer Intern',
    );

    dropTheRow();

    // The prompt has outlived the row it belongs to.
    const stillThere = await conflictDialog();
    await user.click(within(stillThere).getByRole('button', { name: 'Overwrite with my changes' }));

    await waitFor(() => {
      expect(mock.callsTo('PATCH', '/applications/app-1')).toHaveLength(2);
    });

    const second = mock.callsTo('PATCH', '/applications/app-1')[1].data as Record<string, unknown>;
    expect(second.role).toBe('Distributed Systems Intern');
    expect(second).not.toHaveProperty('version');
    // The failure this guards: with the row gone the form used to fall back to
    // its create branch and silently POST a duplicate application.
    expect(mock.callsTo('POST', '/applications')).toHaveLength(0);
  });
});
