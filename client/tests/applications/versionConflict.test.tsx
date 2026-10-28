import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '@/App';
import { makeApplication, makeListResponse, makeSession } from '../utils/factories';
import { installMockApi, type MockApi, type Responder } from '../utils/mockAdapter';
import { renderWithProviders, resetClientState, signIn } from '../utils/render';

const LIST = 'GET /applications';
const PATCH = 'PATCH /applications/app-1';

const mine = makeApplication({
  id: 'app-1',
  company: 'Stripe',
  role: 'Backend Intern',
  status: 'applied',
  version: 3,
});

/** What another writer left on the server while this form was open. */
const theirs = makeApplication({
  id: 'app-1',
  company: 'Stripe',
  role: 'Platform Engineer Intern',
  status: 'interview',
  version: 7,
  updatedAt: '2026-02-14T10:30:00.000Z',
});

/** The exact 409 body `application.service.ts` produces for a stale read. */
const conflictResponse: Responder = () => ({
  status: 409,
  data: {
    success: false,
    message: 'This application was changed somewhere else. Reload to see the latest version.',
    code: 'VERSION_CONFLICT',
    errors: { current: theirs, conflictSource: 'stale_read' },
  },
});

async function openEditAndSave(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await screen.findByText('Stripe');
  await user.click(screen.getByRole('button', { name: 'Edit Stripe' }));

  const dialog = await screen.findByRole('dialog');
  const role = within(dialog).getByLabelText('Role');
  await user.clear(role);
  await user.type(role, 'Backend Engineer Intern');
  await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));
}

/** The row as the server currently holds it; a successful write moves it. */
let stored = mine;

function renderList(routes: Record<string, Responder>): MockApi {
  const mock = installMockApi({
    [LIST]: () => ({ status: 200, data: makeListResponse([stored]) }),
    ...routes,
  });
  signIn(makeSession());
  renderWithProviders(<App />, { route: '/applications' });

  return mock;
}

beforeEach(() => {
  stored = mine;
  resetClientState();
});

afterEach(() => {
  resetClientState();
});

describe('version conflict UI', () => {
  it('sends the version it read, so the server can detect a stale write', async () => {
    const user = userEvent.setup();
    const mock = renderList({ [PATCH]: conflictResponse });

    await openEditAndSave(user);

    await waitFor(() => {
      expect(mock.callsTo('PATCH', '/applications/app-1')).toHaveLength(1);
    });
    const body = mock.callsTo('PATCH', '/applications/app-1')[0].data as Record<string, unknown>;
    expect(body.version).toBe(3);
  });

  it('renders the reload or overwrite prompt with the document that won', async () => {
    const user = userEvent.setup();
    renderList({ [PATCH]: conflictResponse });

    await openEditAndSave(user);

    const prompt = await screen.findByRole('dialog', { name: 'This was changed elsewhere' });
    expect(prompt).toHaveTextContent('You were editing a version that had already been replaced.');

    // The server's document, not a generic message.
    const current = within(prompt).getByTestId('conflict-current');
    expect(current).toHaveTextContent('Platform Engineer Intern');
    expect(current).toHaveTextContent('Interview');
    expect(current).toHaveTextContent('7');

    expect(
      within(prompt).getByRole('button', { name: 'Discard mine and reload' }),
    ).toBeInTheDocument();
    expect(
      within(prompt).getByRole('button', { name: 'Overwrite with my changes' }),
    ).toBeInTheDocument();
  });

  it('rolls the optimistic edit back off the table while the prompt is open', async () => {
    const user = userEvent.setup();
    renderList({ [PATCH]: conflictResponse });

    await openEditAndSave(user);
    await screen.findByRole('dialog', { name: 'This was changed elsewhere' });

    expect(screen.getByText('Backend Intern')).toBeInTheDocument();
  });

  it('loads the server document into the form when the user discards their edit', async () => {
    const user = userEvent.setup();
    renderList({ [PATCH]: conflictResponse });

    await openEditAndSave(user);
    const prompt = await screen.findByRole('dialog', { name: 'This was changed elsewhere' });
    await user.click(within(prompt).getByRole('button', { name: 'Discard mine and reload' }));

    const dialog = await screen.findByRole('dialog', { name: 'Edit application' });
    expect(within(dialog).getByLabelText('Role')).toHaveValue('Platform Engineer Intern');
    expect(within(dialog).getByLabelText('Status')).toHaveValue('interview');
  });

  it('retries without a version when the user chooses to overwrite', async () => {
    const user = userEvent.setup();
    let attempts = 0;

    const mock = renderList({
      [PATCH]: (request) => {
        attempts += 1;
        if (attempts === 1) return conflictResponse(request);

        stored = { ...mine, role: 'Backend Engineer Intern', version: 8 };
        return { status: 200, data: { success: true, data: { application: stored } } };
      },
    });

    await openEditAndSave(user);
    const prompt = await screen.findByRole('dialog', { name: 'This was changed elsewhere' });
    await user.click(within(prompt).getByRole('button', { name: 'Overwrite with my changes' }));

    await waitFor(() => {
      expect(mock.callsTo('PATCH', '/applications/app-1')).toHaveLength(2);
    });

    const second = mock.callsTo('PATCH', '/applications/app-1')[1].data as Record<string, unknown>;
    expect(second).not.toHaveProperty('version');
    expect(second.role).toBe('Backend Engineer Intern');
  });

  it('overwrites with the same parsed body the first save sent, not the raw inputs', async () => {
    const user = userEvent.setup();
    let attempts = 0;

    const mock = renderList({
      [PATCH]: (request) => {
        attempts += 1;
        if (attempts === 1) return conflictResponse(request);
        return { status: 200, data: { success: true, data: { application: stored } } };
      },
    });

    await openEditAndSave(user);
    const prompt = await screen.findByRole('dialog', { name: 'This was changed elsewhere' });
    await user.click(within(prompt).getByRole('button', { name: 'Overwrite with my changes' }));

    await waitFor(() => {
      expect(mock.callsTo('PATCH', '/applications/app-1')).toHaveLength(2);
    });

    // An empty URL input is '' until the schema turns it into undefined; the API's
    // `.url()` rejects '', so a raw overwrite of a row with no website was a 400.
    const [first, second] = mock
      .callsTo('PATCH', '/applications/app-1')
      .map(({ data }) => ({ ...(data as Record<string, unknown>), version: undefined }));
    expect(second).toEqual(first);
  });
});
