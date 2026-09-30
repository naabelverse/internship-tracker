import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApplicationFormModal } from '@/features/applications/ApplicationFormModal';
import { makeApplication, makeSession } from '../utils/factories';
import { installMockApi } from '../utils/mockAdapter';
import { renderWithProviders, resetClientState, signIn } from '../utils/render';

/**
 * The Priority select used to pass the stored enum straight through as its
 * label, so the form read "low / medium / high" beside "Full time" and "Not set".
 * The label is display-only: the value submitted to the API must stay lowercase,
 * because the server's enum, filters and sort all key on it.
 */

beforeEach(() => {
  resetClientState();
  signIn(makeSession());
});

afterEach(() => {
  resetClientState();
});

const prioritySelect = async (): Promise<HTMLSelectElement> => {
  const dialog = await screen.findByRole('dialog', { name: 'New application' });
  return within(dialog).getByLabelText<HTMLSelectElement>('Priority');
};

describe('priority select labels', () => {
  it('shows capitalised labels over lowercase values', async () => {
    installMockApi({});
    renderWithProviders(<ApplicationFormModal isOpen onClose={() => undefined} />);

    const select = await prioritySelect();
    const options = within(select).getAllByRole<HTMLOptionElement>('option');

    expect(options.map((option) => option.textContent)).toEqual(['Low', 'Medium', 'High']);
    expect(options.map((option) => option.value)).toEqual(['low', 'medium', 'high']);
    // The closed trigger shows the selected option's label.
    expect(select.selectedOptions[0]?.textContent).toBe('Medium');
  });

  it('submits the lowercase value', async () => {
    const user = userEvent.setup();
    const mock = installMockApi({
      'POST /applications': () => ({
        status: 201,
        data: { success: true, data: { application: makeApplication({ priority: 'high' }) } },
      }),
    });
    renderWithProviders(<ApplicationFormModal isOpen onClose={() => undefined} />);

    const select = await prioritySelect();
    const dialog = screen.getByRole('dialog', { name: 'New application' });
    await user.type(within(dialog).getByLabelText('Company'), 'Stripe');
    await user.type(within(dialog).getByLabelText('Role'), 'Backend Intern');
    await user.selectOptions(select, 'High');
    await user.click(screen.getByRole('button', { name: 'Create application' }));

    await waitFor(() => {
      expect(mock.callsTo('POST', '/applications')).toHaveLength(1);
    });
    const sent = mock.callsTo('POST', '/applications')[0].data as Record<string, unknown>;
    expect(sent.priority).toBe('high');
  });
});
