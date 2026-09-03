import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '@/App';
import { errorBody, makeApplication, makeListResponse, makeSession } from '../utils/factories';
import { createGate, installMockApi, type Responder } from '../utils/mockAdapter';
import { renderWithProviders, resetClientState, signIn } from '../utils/render';

const LIST = 'GET /applications';

const application = () =>
  makeApplication({ id: 'app-1', company: 'Stripe', role: 'Backend Intern', status: 'applied' });

function statusSelect(): HTMLSelectElement {
  return screen.getByLabelText('Status for Stripe') as HTMLSelectElement;
}

beforeEach(() => {
  resetClientState();
});

afterEach(() => {
  resetClientState();
});

describe('inline status change rollback', () => {
  it('shows the new status immediately, then reverts when the server rejects it', async () => {
    const user = userEvent.setup();
    const gate = createGate();
    const row = application();

    const rejectStatus: Responder = async () => {
      await gate.wait;
      return {
        status: 400,
        data: errorBody('Validation failed', 'VALIDATION_ERROR', { status: ['is not allowed'] }),
      };
    };

    installMockApi({
      [LIST]: () => ({ status: 200, data: makeListResponse([row]) }),
      'PATCH /applications/app-1/status': rejectStatus,
    });
    signIn(makeSession());

    renderWithProviders(<App />, { route: '/applications' });
    await screen.findByText('Stripe');
    expect(statusSelect().value).toBe('applied');

    await user.selectOptions(statusSelect(), 'offer');

    // The optimistic write is on screen while the request is still in flight.
    await waitFor(() => {
      expect(statusSelect().value).toBe('offer');
    });

    gate.open();

    // …and the snapshot taken in onMutate puts the original value back.
    await waitFor(() => {
      expect(statusSelect().value).toBe('applied');
    });
  });

  it('reverts a status change that fails at the transport layer', async () => {
    const user = userEvent.setup();
    const row = application();

    installMockApi({
      [LIST]: () => ({ status: 200, data: makeListResponse([row]) }),
      'PATCH /applications/app-1/status': () => {
        throw new Error('Network down');
      },
    });
    signIn(makeSession());

    renderWithProviders(<App />, { route: '/applications' });
    await screen.findByText('Stripe');

    await user.selectOptions(statusSelect(), 'rejected');

    await waitFor(() => {
      expect(statusSelect().value).toBe('applied');
    });
    expect(screen.getByText('Stripe')).toBeInTheDocument();
  });

  it('keeps the new status when the server accepts it', async () => {
    const user = userEvent.setup();
    // Stateful, because `onSettled` refetches: a mock that kept returning the
    // pre-mutation row would undo the commit and hide a genuine regression.
    const state = { row: application() };

    installMockApi({
      [LIST]: () => ({ status: 200, data: makeListResponse([state.row]) }),
      'PATCH /applications/app-1/status': () => {
        state.row = { ...state.row, status: 'offer', version: state.row.version + 1 };
        return { status: 200, data: { success: true, data: { application: state.row } } };
      },
    });
    signIn(makeSession());

    renderWithProviders(<App />, { route: '/applications' });
    await screen.findByText('Stripe');

    await user.selectOptions(statusSelect(), 'offer');

    await waitFor(() => {
      expect(statusSelect().value).toBe('offer');
    });
  });
});

describe('edit modal rollback', () => {
  it('reverts the row when saving the edit fails', async () => {
    const user = userEvent.setup();
    const gate = createGate();
    const row = application();

    installMockApi({
      [LIST]: () => ({ status: 200, data: makeListResponse([row]) }),
      'PATCH /applications/app-1': async () => {
        await gate.wait;
        return { status: 500, data: errorBody('Something went wrong', 'INTERNAL_ERROR') };
      },
    });
    signIn(makeSession());

    renderWithProviders(<App />, { route: '/applications' });
    await screen.findByText('Stripe');

    await user.click(screen.getByRole('button', { name: 'Edit Stripe' }));

    const dialog = await screen.findByRole('dialog');
    const company = within(dialog).getByLabelText('Company');
    await user.clear(company);
    await user.type(company, 'Stripe Payments');
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    // The table shows the edit before the server has agreed to it.
    await waitFor(() => {
      expect(screen.getByText('Stripe Payments')).toBeInTheDocument();
    });

    gate.open();

    await waitFor(() => {
      expect(screen.getByText('Stripe')).toBeInTheDocument();
    });
    expect(screen.queryByText('Stripe Payments')).not.toBeInTheDocument();
  });
});
