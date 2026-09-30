import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApplicationFormModal } from '@/features/applications/ApplicationFormModal';
import { InterviewFormModal } from '@/features/applications/detail/InterviewFormModal';
import { makeApplication, makeSession } from '../utils/factories';
import { installMockApi } from '../utils/mockAdapter';
import { renderWithProviders, resetClientState, signIn } from '../utils/render';

/**
 * The three places the app asks for a date — Applied date and Deadline on the
 * application form, Scheduled at on the interview form — all open the app's
 * calendar, and what it picks reaches the API through each form's own
 * `register` and schema. The clock is pinned so the month shown is fixed.
 */

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 8, 30, 10, 0));
  resetClientState();
  signIn(makeSession());
});

afterEach(() => {
  vi.useRealTimers();
  resetClientState();
});

async function pick(dialog: HTMLElement, field: string, day: RegExp): Promise<void> {
  const user = userEvent.setup();
  await user.click(within(dialog).getByRole('button', { name: `${field}, choose from calendar` }));
  const calendar = within(dialog).getByRole('dialog', { name: field });
  await user.click(within(calendar).getByRole('button', { name: day }));
}

describe('the application form', () => {
  it('fills Applied date and Deadline from the calendar and sends them', async () => {
    const mock = installMockApi({
      'POST /applications': () => ({
        status: 201,
        data: { success: true, data: { application: makeApplication() } },
      }),
    });
    renderWithProviders(<ApplicationFormModal isOpen onClose={() => undefined} />);
    const dialog = await screen.findByRole('dialog', { name: 'New application' });
    const user = userEvent.setup();
    await user.type(within(dialog).getByLabelText('Company'), 'Stripe');
    await user.type(within(dialog).getByLabelText('Role'), 'Backend Intern');

    await pick(dialog, 'Applied date', /September 14th, 2026/);
    await pick(dialog, 'Deadline', /October 1st, 2026/);
    expect(dialog).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Create application' }));

    await waitFor(() => {
      expect(mock.callsTo('POST', '/applications')).toHaveLength(1);
    });
    const sent = mock.callsTo('POST', '/applications')[0].data as Record<string, unknown>;
    expect(sent.appliedDate).toBe('2026-09-14T00:00:00.000Z');
    expect(sent.deadline).toBe('2026-10-01T00:00:00.000Z');
  });
});

describe('the interview form', () => {
  it('fills Scheduled at from the calendar, at 09:00, and sends it', async () => {
    const application = makeApplication();
    const interviewsUrl = `/applications/${application.id}/interviews`;
    const mock = installMockApi({
      [`POST ${interviewsUrl}`]: () => ({
        status: 201,
        data: { success: true, data: { application } },
      }),
    });
    renderWithProviders(
      <InterviewFormModal isOpen applicationId={application.id} onClose={() => undefined} />,
    );
    const dialog = screen.getByRole('dialog', { name: 'Add an interview' });

    await pick(dialog, 'Scheduled at', /October 6th, 2026/);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Add interview' }));

    await waitFor(() => {
      expect(mock.callsTo('POST', interviewsUrl)).toHaveLength(1);
    });
    const sent = mock.callsTo('POST', interviewsUrl)[0].data as Record<string, unknown>;
    expect(sent.scheduledAt).toBe(new Date(2026, 9, 6, 9, 0).toISOString());
  });
});
