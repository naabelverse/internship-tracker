import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApplicationFormModal } from '@/features/applications/ApplicationFormModal';
import { InterviewFormModal } from '@/features/applications/detail/InterviewFormModal';
import { isDateInputInRange } from '@/lib/dateInput';
import { makeApplication, makeSession } from '../utils/factories';
import { installMockApi } from '../utils/mockAdapter';
import { renderWithProviders, resetClientState, signIn } from '../utils/render';

/**
 * A native date input accepts a year up to 275760, so "11/11/111111" could be
 * typed into Applied date, sent, and bounced by the API only by accident. The
 * interview form was worse: that value made `toISOString()` throw inside the
 * submit handler, so nothing was sent and nothing was shown.
 *
 * Typing, pasting and picking from the calendar all end the same way — the
 * input's `value` changes and it fires `change` — so setting the value with a
 * change event exercises every entry path at once.
 */

beforeEach(() => {
  resetClientState();
  signIn(makeSession());
});

afterEach(() => {
  resetClientState();
});

const APPLICATION_FIELDS = ['Applied date', 'Deadline'] as const;

async function openApplicationForm(): Promise<HTMLElement> {
  renderWithProviders(<ApplicationFormModal isOpen onClose={() => undefined} />);
  const dialog = await screen.findByRole('dialog', { name: 'New application' });
  const user = userEvent.setup();
  await user.type(within(dialog).getByLabelText('Company'), 'Stripe');
  await user.type(within(dialog).getByLabelText('Role'), 'Backend Intern');
  return dialog;
}

const createdResponse = () => ({
  status: 201,
  data: { success: true, data: { application: makeApplication() } },
});

describe('isDateInputInRange', () => {
  it.each(['', '2000-01-01', '2026-10-01', '2099-12-31', '2026-10-01T14:30'])(
    'accepts %s',
    (value) => {
      expect(isDateInputInRange(value)).toBe(true);
    },
  );

  it.each([
    '111111-11-11',
    '111111-11-11T10:00',
    '0026-01-01',
    '1999-12-31',
    '2100-01-01',
    '2026-02-30',
    '11/11/2026',
  ])('rejects %s', (value) => {
    expect(isDateInputInRange(value)).toBe(false);
  });
});

describe('application form date fields', () => {
  it.each(APPLICATION_FIELDS)('bounds %s to 2000–2099 in the native picker', async (label) => {
    installMockApi({});
    const dialog = await openApplicationForm();

    const input = within(dialog).getByLabelText<HTMLInputElement>(label);
    expect(input.type).toBe('date');
    expect(input.min).toBe('2000-01-01');
    expect(input.max).toBe('2099-12-31');
  });

  it.each(APPLICATION_FIELDS)(
    'blocks a six-digit year in %s and says why, next to the field',
    async (label) => {
      const mock = installMockApi({ 'POST /applications': createdResponse });
      const dialog = await openApplicationForm();

      const input = within(dialog).getByLabelText<HTMLInputElement>(label);
      fireEvent.change(input, { target: { value: '111111-11-11' } });
      expect(input.value).toBe('111111-11-11');
      await userEvent.setup().click(screen.getByRole('button', { name: 'Create application' }));

      expect(await within(dialog).findByText('Enter a date between 2000 and 2099')).toBeVisible();
      expect(input).toHaveAttribute('aria-invalid', 'true');
      expect(mock.callsTo('POST', '/applications')).toHaveLength(0);
    },
  );

  it('blocks a two-digit year, which the browser reads as year 0026', async () => {
    const mock = installMockApi({ 'POST /applications': createdResponse });
    const dialog = await openApplicationForm();

    fireEvent.change(within(dialog).getByLabelText('Deadline'), {
      target: { value: '0026-10-01' },
    });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Create application' }));

    expect(await within(dialog).findByText('Enter a date between 2000 and 2099')).toBeVisible();
    expect(mock.callsTo('POST', '/applications')).toHaveLength(0);
  });

  it('still sends an ordinary date unchanged', async () => {
    const mock = installMockApi({ 'POST /applications': createdResponse });
    const dialog = await openApplicationForm();

    fireEvent.change(within(dialog).getByLabelText('Applied date'), {
      target: { value: '2026-09-14' },
    });
    fireEvent.change(within(dialog).getByLabelText('Deadline'), {
      target: { value: '2026-10-01' },
    });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Create application' }));

    await waitFor(() => {
      expect(mock.callsTo('POST', '/applications')).toHaveLength(1);
    });
    const sent = mock.callsTo('POST', '/applications')[0].data as Record<string, unknown>;
    expect(sent.appliedDate).toBe('2026-09-14T00:00:00.000Z');
    expect(sent.deadline).toBe('2026-10-01T00:00:00.000Z');
  });

  it('shows the API’s date error on the field it names', async () => {
    installMockApi({
      'POST /applications': () => ({
        status: 400,
        data: {
          success: false,
          message: 'Validation failed',
          code: 'VALIDATION_ERROR',
          errors: { deadline: ['must be between 2000 and 2099'] },
        },
      }),
    });
    const dialog = await openApplicationForm();

    fireEvent.change(within(dialog).getByLabelText('Deadline'), {
      target: { value: '2026-10-01' },
    });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Create application' }));

    expect(await within(dialog).findByText('Must be between 2000 and 2099')).toBeVisible();
    expect(within(dialog).getByLabelText('Deadline')).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('interview form date field', () => {
  const application = makeApplication();
  const interviewsUrl = `/applications/${application.id}/interviews`;

  function openInterviewForm(): HTMLElement {
    renderWithProviders(
      <InterviewFormModal isOpen applicationId={application.id} onClose={() => undefined} />,
    );
    return screen.getByRole('dialog', { name: 'Add an interview' });
  }

  it('bounds Scheduled at to 2000–2099 in the native picker', () => {
    installMockApi({});
    const input = within(openInterviewForm()).getByLabelText<HTMLInputElement>('Scheduled at');

    expect(input.type).toBe('datetime-local');
    expect(input.min).toBe('2000-01-01T00:00');
    expect(input.max).toBe('2099-12-31T23:59');
  });

  it('shows an error for a six-digit year instead of failing silently', async () => {
    const mock = installMockApi({
      [`POST ${interviewsUrl}`]: () => ({
        status: 201,
        data: { success: true, data: { application } },
      }),
    });
    const dialog = openInterviewForm();

    fireEvent.change(within(dialog).getByLabelText('Scheduled at'), {
      target: { value: '111111-11-11T10:00' },
    });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Add interview' }));

    expect(await within(dialog).findByText('Enter a date between 2000 and 2099')).toBeVisible();
    expect(mock.callsTo('POST', interviewsUrl)).toHaveLength(0);
  });

  it('still sends an ordinary date and time', async () => {
    const mock = installMockApi({
      [`POST ${interviewsUrl}`]: () => ({
        status: 201,
        data: { success: true, data: { application } },
      }),
    });
    const dialog = openInterviewForm();

    fireEvent.change(within(dialog).getByLabelText('Scheduled at'), {
      target: { value: '2026-11-02T10:00' },
    });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Add interview' }));

    await waitFor(() => {
      expect(mock.callsTo('POST', interviewsUrl)).toHaveLength(1);
    });
    const sent = mock.callsTo('POST', interviewsUrl)[0].data as Record<string, unknown>;
    expect(sent.scheduledAt).toBe(new Date('2026-11-02T10:00').toISOString());
  });
});
