import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '@/App';
import { ApplicationFormModal } from '@/features/applications/ApplicationFormModal';
import { formatSource, sourceLabel } from '@/lib/statusConfig';
import type { Application } from '@/types/application';
import { makeApplication, makeSession } from '../utils/factories';
import { installMockApi, type MockApi } from '../utils/mockAdapter';
import { renderWithProviders, resetClientState, signIn } from '../utils/render';

/**
 * A row written before Internshala left the list. The client type only names
 * current values, so the cast is the point: this is data the type says cannot
 * arrive, and which a database that has not run migration 002 still holds.
 */
const LEGACY_SOURCE = 'internshala' as Application['source'];

beforeEach(() => {
  resetClientState();
  signIn(makeSession());
});

afterEach(() => {
  resetClientState();
});

function mockCreate(): MockApi {
  return installMockApi({
    'POST /applications': () => ({
      status: 201,
      data: { success: true, data: { application: makeApplication() } },
    }),
  });
}

async function openNewForm(): Promise<HTMLElement> {
  renderWithProviders(<ApplicationFormModal isOpen onClose={() => undefined} />);
  const dialog = await screen.findByRole('dialog', { name: 'New application' });
  const user = userEvent.setup();
  await user.type(within(dialog).getByLabelText('Company'), 'Grab');
  await user.type(within(dialog).getByLabelText('Role'), 'Backend Intern');
  return dialog;
}

const sentBody = (mock: MockApi): Record<string, unknown> =>
  mock.callsTo('POST', '/applications')[0].data as Record<string, unknown>;

describe('the Source select', () => {
  it('lists the Malaysia-focused options in order', async () => {
    installMockApi({});
    renderWithProviders(<ApplicationFormModal isOpen onClose={() => undefined} />);
    const dialog = await screen.findByRole('dialog', { name: 'New application' });

    const options = within(within(dialog).getByLabelText('Source')).getAllByRole('option');

    expect(options.map((option) => option.textContent)).toEqual([
      'Not set',
      'JobStreet',
      'LinkedIn',
      'Indeed',
      'Hiredly',
      'Maukerja',
      'MYFutureJobs',
      'Company site',
      'Referral',
      'Career fair',
      'Other',
    ]);
  });

  it('submits a named source as before, with no specify field or text', async () => {
    const user = userEvent.setup();
    const mock = mockCreate();
    const dialog = await openNewForm();

    await user.selectOptions(within(dialog).getByLabelText('Source'), 'JobStreet');

    expect(within(dialog).queryByLabelText('Other source')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Create application' }));

    await waitFor(() => {
      expect(mock.callsTo('POST', '/applications')).toHaveLength(1);
    });
    expect(sentBody(mock).source).toBe('jobstreet');
    expect(sentBody(mock).sourceOther).toBeUndefined();
  });
});

describe('"Other: please specify"', () => {
  it('reveals the text input only once Other is chosen', async () => {
    const user = userEvent.setup();
    mockCreate();
    const dialog = await openNewForm();

    expect(within(dialog).queryByLabelText('Other source')).not.toBeInTheDocument();
    await user.selectOptions(within(dialog).getByLabelText('Source'), 'Other');

    expect(within(dialog).getByLabelText('Other source')).toBeInTheDocument();
  });

  it('submits other with the text the user typed', async () => {
    const user = userEvent.setup();
    const mock = mockCreate();
    const dialog = await openNewForm();

    await user.selectOptions(within(dialog).getByLabelText('Source'), 'Other');
    await user.type(within(dialog).getByLabelText('Other source'), '  Glints ');
    await user.click(screen.getByRole('button', { name: 'Create application' }));

    await waitFor(() => {
      expect(mock.callsTo('POST', '/applications')).toHaveLength(1);
    });
    expect(sentBody(mock).source).toBe('other');
    expect(sentBody(mock).sourceOther).toBe('Glints');
  });

  it('requires the text, since Other alone says nothing later', async () => {
    const user = userEvent.setup();
    const mock = mockCreate();
    const dialog = await openNewForm();

    await user.selectOptions(within(dialog).getByLabelText('Source'), 'Other');
    await user.click(screen.getByRole('button', { name: 'Create application' }));

    expect(await within(dialog).findByText('Say where you found it')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Other source')).toHaveAttribute('aria-invalid', 'true');
    expect(mock.callsTo('POST', '/applications')).toHaveLength(0);
  });

  it('drops typed text when the user switches back to a named source', async () => {
    const user = userEvent.setup();
    const mock = mockCreate();
    const dialog = await openNewForm();
    const select = within(dialog).getByLabelText('Source');

    await user.selectOptions(select, 'Other');
    await user.type(within(dialog).getByLabelText('Other source'), 'Glints');
    await user.selectOptions(select, 'Hiredly');
    await user.click(screen.getByRole('button', { name: 'Create application' }));

    await waitFor(() => {
      expect(mock.callsTo('POST', '/applications')).toHaveLength(1);
    });
    expect(sentBody(mock).source).toBe('hiredly');
    expect(sentBody(mock).sourceOther).toBeUndefined();
  });

  it('opens a saved Other with its text filled in', async () => {
    installMockApi({});
    const application = makeApplication({ source: 'other', sourceOther: 'Glints' });
    renderWithProviders(
      <ApplicationFormModal isOpen onClose={() => undefined} application={application} />,
    );
    const dialog = await screen.findByRole('dialog', { name: 'Edit application' });

    expect(within(dialog).getByLabelText<HTMLSelectElement>('Source').value).toBe('other');
    expect(within(dialog).getByLabelText('Other source')).toHaveValue('Glints');
  });
});

describe('a record holding a retired source', () => {
  it('opens in the form as Other with the stored value, not a blank "Not set"', async () => {
    installMockApi({});
    const application = makeApplication({ source: LEGACY_SOURCE });
    renderWithProviders(
      <ApplicationFormModal isOpen onClose={() => undefined} application={application} />,
    );
    const dialog = await screen.findByRole('dialog', { name: 'Edit application' });

    expect(within(dialog).getByLabelText<HTMLSelectElement>('Source').value).toBe('other');
    expect(within(dialog).getByLabelText('Other source')).toHaveValue('internshala');
  });

  it('renders on the detail page with the stored value', async () => {
    const application = makeApplication({ id: 'legacy-1', source: LEGACY_SOURCE });
    installMockApi({
      'GET /applications/legacy-1': () => ({
        status: 200,
        data: { success: true, data: { application } },
      }),
    });
    renderWithProviders(<App />, { route: '/applications/legacy-1' });

    const label = await screen.findByText('Source');
    expect(label.parentElement).toHaveTextContent('internshala');
  });
});

describe('formatSource', () => {
  it.each([
    [undefined, undefined, '—'],
    ['jobstreet', undefined, 'JobStreet'],
    ['myfuturejobs', undefined, 'MYFutureJobs'],
    ['other', 'Glints', 'Other: Glints'],
    ['other', undefined, 'Other'],
    ['linkedin', 'stale text', 'LinkedIn'],
    ['internshala', undefined, 'internshala'],
  ])('formats %s / %s as %s', (source, sourceOther, expected) => {
    expect(formatSource(source, sourceOther)).toBe(expected);
  });

  it('does not treat an inherited property name as a known source', () => {
    expect(sourceLabel('constructor')).toBe('constructor');
  });
});
