import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import toast from 'react-hot-toast';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Sidebar } from '@/components/layout/Sidebar';
import { makeSession, makeUser } from '../utils/factories';
import { installMockApi } from '../utils/mockAdapter';
import { renderWithProviders, resetClientState, signIn } from '../utils/render';

const accepted = () => ({ status: 202, data: { success: true, data: null } });

// The Toaster lives in main.tsx and is not mounted in tests, so the calls are spied.
afterEach(() => {
  resetClientState();
  vi.restoreAllMocks();
});

async function openFeedback(onClose = vi.fn()) {
  const user = userEvent.setup();
  const account = makeUser();
  signIn(makeSession({ user: account }));
  renderWithProviders(<Sidebar isOpen onClose={onClose} />);

  await user.click(screen.getByRole('button', { name: 'Send feedback' }));

  return { user, account, dialog: screen.getByRole('dialog', { name: 'Send feedback' }) };
}

describe('the feedback modal', () => {
  it('closes the drawer and opens with the account email as the reply address', async () => {
    installMockApi({});
    const onClose = vi.fn();
    const { account, dialog } = await openFeedback(onClose);

    expect(onClose).toHaveBeenCalled();
    expect(within(dialog).getByRole('radio', { name: 'General feedback' })).toBeChecked();
    expect(within(dialog).getByLabelText(/Your email/)).toHaveValue(account.email);
    expect(within(dialog).getByRole('button', { name: 'Send feedback' })).toBeDisabled();
  });

  it('posts the category, message and reply address, then closes', async () => {
    const mock = installMockApi({ 'POST /email/feedback': accepted });
    const success = vi.spyOn(toast, 'success');
    const { user, dialog } = await openFeedback();

    await user.click(within(dialog).getByRole('radio', { name: 'Bug' }));
    await user.type(within(dialog).getByLabelText('Your message'), 'The board froze.');
    await user.clear(within(dialog).getByLabelText(/Your email/));
    await user.click(within(dialog).getByRole('button', { name: 'Send feedback' }));

    expect(mock.callsTo('POST', '/email/feedback')[0]?.data).toEqual({
      category: 'bug',
      message: 'The board froze.',
      replyTo: '',
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Send feedback' })).not.toBeInTheDocument();
    });
    expect(success).toHaveBeenCalledWith('Thanks — your feedback is on its way');
  });

  it('keeps the dialog open and says so when sending fails', async () => {
    installMockApi({ 'POST /email/feedback': () => ({ status: 500, data: { success: false } }) });
    const failure = vi.spyOn(toast, 'error');
    const { user, dialog } = await openFeedback();

    await user.type(within(dialog).getByLabelText('Your message'), 'Hello');
    await user.click(within(dialog).getByRole('button', { name: 'Send feedback' }));

    await waitFor(() => {
      expect(failure).toHaveBeenCalledWith(expect.stringMatching(/could not be sent/));
    });
    expect(screen.getByRole('dialog', { name: 'Send feedback' })).toBeInTheDocument();
  });
});
