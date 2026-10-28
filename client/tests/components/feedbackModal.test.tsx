import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import toast from 'react-hot-toast';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Sidebar } from '@/components/layout/Sidebar';
import { makeSession } from '../utils/factories';
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
  signIn(makeSession());
  renderWithProviders(<Sidebar isOpen onClose={onClose} />);

  await user.click(screen.getByRole('button', { name: 'Send feedback' }));

  // The modal is a lazy chunk, so it appears after the click rather than with it.
  return { user, dialog: await screen.findByRole('dialog', { name: 'Send feedback' }) };
}

describe('the feedback modal', () => {
  it('closes the drawer and opens with no email field, since replies go to the account', async () => {
    installMockApi({});
    const onClose = vi.fn();
    const { dialog } = await openFeedback(onClose);

    expect(onClose).toHaveBeenCalled();
    expect(within(dialog).getByRole('radio', { name: 'General feedback' })).toBeChecked();
    expect(within(dialog).queryByRole('textbox', { name: /email/i })).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Send feedback' })).toBeDisabled();
  });

  it('posts the category and message, then closes', async () => {
    const mock = installMockApi({ 'POST /email/feedback': accepted });
    const success = vi.spyOn(toast, 'success');
    const { user, dialog } = await openFeedback();

    await user.click(within(dialog).getByRole('radio', { name: 'Bug' }));
    await user.type(within(dialog).getByLabelText('Your message'), 'The board froze.');
    await user.click(within(dialog).getByRole('button', { name: 'Send feedback' }));

    expect(mock.callsTo('POST', '/email/feedback')[0]?.data).toEqual({
      category: 'bug',
      message: 'The board froze.',
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

  it('keeps an unsent draft across closing and reopening', async () => {
    installMockApi({});
    const { user, dialog } = await openFeedback();

    await user.type(within(dialog).getByLabelText('Your message'), 'Half a thought');
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Send feedback' })).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Send feedback' }));
    const reopened = await screen.findByRole('dialog', { name: 'Send feedback' });
    expect(within(reopened).getByLabelText('Your message')).toHaveValue('Half a thought');
  });
});
