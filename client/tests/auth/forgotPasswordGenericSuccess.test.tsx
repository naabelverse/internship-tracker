import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '@/App';
import { installMockApi, type MockApi, type Responder } from '../utils/mockAdapter';
import { renderWithProviders, resetClientState } from '../utils/render';

/**
 * The client half of Phase 11's no-enumeration guarantee.
 *
 * The server answers `/auth/forgot-password` identically for an address that has
 * an account and one that does not. That is worth nothing if the UI then says
 * something different, so this asserts the rendered result is the same for both,
 * and the same again when the request fails outright - a network error on a real
 * account must not be distinguishable from one on a fake address either.
 */

const FORGOT = 'POST /auth/forgot-password';
const REAL = 'ada@example.com';
const FAKE = 'nobody-has-this@example.com';

/** The exact body the server sends, whoever asked. */
const identicalReply: Responder = () => ({
  status: 200,
  data: {
    success: true,
    data: { requested: true },
    message: 'If that address has an account, a reset link is on its way.',
  },
});

beforeEach(() => {
  resetClientState();
});

afterEach(() => {
  resetClientState();
});

/** Submits the form and returns the whole rendered confirmation, as text. */
async function submit(email: string, responder: Responder): Promise<string> {
  const user = userEvent.setup();
  const mock: MockApi = installMockApi({ [FORGOT]: responder });
  renderWithProviders(<App />, { route: '/forgot-password' });

  await user.type(await screen.findByLabelText('Email'), email);
  await user.click(screen.getByRole('button', { name: 'Send reset link' }));

  const panel = await screen.findByTestId('forgot-password-sent');
  const rendered = panel.textContent ?? '';

  expect(mock.callsTo('POST', '/auth/forgot-password')).toHaveLength(1);
  resetClientState();

  return rendered;
}

describe('forgot-password reveals nothing about which addresses exist', () => {
  it('renders the same confirmation for a real and a fake address', async () => {
    const real = await submit(REAL, identicalReply);
    const fake = await submit(FAKE, identicalReply);

    // The address itself is echoed back, so compare with it factored out.
    expect(fake.replace(FAKE, '<address>')).toBe(real.replace(REAL, '<address>'));
  });

  it('renders that same confirmation even when the request fails', async () => {
    const real = await submit(REAL, identicalReply);
    const broken = await submit(FAKE, () => ({
      status: 500,
      data: { success: false, message: 'Something went wrong', code: 'INTERNAL_ERROR' },
    }));

    expect(broken.replace(FAKE, '<address>')).toBe(real.replace(REAL, '<address>'));
  });

  it('never says an address is unknown, and never checks before submitting', async () => {
    const user = userEvent.setup();
    const mock = installMockApi({ [FORGOT]: identicalReply });
    renderWithProviders(<App />, { route: '/forgot-password' });

    await user.type(await screen.findByLabelText('Email'), FAKE);

    // Nothing may probe for existence while the address is being typed.
    expect(mock.callsTo('POST', '/auth/forgot-password')).toHaveLength(0);
    expect(mock.callsTo('GET', '/auth/me')).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'Send reset link' }));

    const panel = await screen.findByTestId('forgot-password-sent');
    expect(panel.textContent).not.toMatch(/not found|no account|unknown|isn't registered/i);
  });
});
