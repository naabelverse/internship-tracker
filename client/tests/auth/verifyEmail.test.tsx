import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { App } from '@/App';
import { makeSession, makeUser } from '../utils/factories';
import { installMockApi, type Responder } from '../utils/mockAdapter';
import { renderWithProviders, resetClientState, signIn } from '../utils/render';
import { verificationState } from '@/features/auth/verificationWindow';

const VERIFY = 'POST /auth/verify-email';

const errorReply =
  (code: string): Responder =>
  () => ({
    status: 400,
    data: { success: false, message: 'no', code },
  });

function open(token: string | null, responder: Responder): void {
  installMockApi({ [VERIFY]: responder });
  renderWithProviders(<App />, {
    route: token === null ? '/verify-email' : `/verify-email?token=${token}`,
  });
}

beforeEach(() => {
  resetClientState();
});

afterEach(() => {
  resetClientState();
});

describe('/verify-email tells the three failures apart', () => {
  it('confirms a good token', async () => {
    open('good-token', () => ({
      status: 200,
      data: { success: true, data: { user: makeUser({ emailVerified: true }) } },
    }));

    expect(await screen.findByTestId('verify-confirmed')).toBeInTheDocument();
  });

  it('says expired, not just failed, for an expired token', async () => {
    open('stale-token', errorReply('TOKEN_EXPIRED'));

    const message = await screen.findByTestId('verify-expired');
    expect(message).toHaveTextContent(/24 hours/);
  });

  it('says already used for a token that is gone', async () => {
    open('spent-token', errorReply('INVALID_TOKEN'));

    expect(await screen.findByTestId('verify-used')).toBeInTheDocument();
  });

  it('says the link is incomplete when there is no token at all', async () => {
    open(null, errorReply('INVALID_TOKEN'));

    expect(await screen.findByTestId('verify-missing')).toBeInTheDocument();
  });
});

/**
 * The banner's escalation is derived from `emailVerified` and `createdAt`, the
 * two fields `/auth/me` actually returns. Nothing here reads a field the server
 * does not send.
 */
describe('the verification window', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const now = Date.parse('2026-09-04T00:00:00.000Z');
  const madeAt = (msAgo: number): string => new Date(now - msAgo).toISOString();

  it('is silent for a confirmed account', () => {
    expect(verificationState(makeUser({ emailVerified: true }), now)).toBe('verified');
  });

  it('is calm early in the window and urgent near the end', () => {
    expect(verificationState(makeUser({ emailVerified: false, createdAt: madeAt(DAY) }), now)).toBe(
      'grace',
    );
    expect(
      verificationState(makeUser({ emailVerified: false, createdAt: madeAt(5 * DAY) }), now),
    ).toBe('urgent');
  });

  it('reports expired only once the seven days are actually up', () => {
    expect(
      verificationState(
        makeUser({ emailVerified: false, createdAt: madeAt(7 * DAY - 60_000) }),
        now,
      ),
    ).toBe('urgent');
    expect(
      verificationState(
        makeUser({ emailVerified: false, createdAt: madeAt(7 * DAY + 60_000) }),
        now,
      ),
    ).toBe('expired');
  });
});

describe('the banner', () => {
  it('shows for an unverified account and offers a resend', async () => {
    const user = makeUser({ emailVerified: false, createdAt: new Date().toISOString() });
    installMockApi({
      'GET /auth/me': () => ({ status: 200, data: { success: true, data: { user } } }),
      'GET /applications': () => ({
        status: 200,
        data: {
          success: true,
          data: { applications: [] },
          meta: { total: 0, page: 1, limit: 25, totalPages: 0 },
        },
      }),
    });
    signIn(makeSession({ user }));
    renderWithProviders(<App />, { route: '/applications' });

    expect(await screen.findByRole('button', { name: 'Resend link' })).toBeInTheDocument();
  });

  it('stays out of the way for a confirmed account', async () => {
    const user = makeUser({ emailVerified: true });
    installMockApi({
      'GET /auth/me': () => ({ status: 200, data: { success: true, data: { user } } }),
      'GET /applications': () => ({
        status: 200,
        data: {
          success: true,
          data: { applications: [] },
          meta: { total: 0, page: 1, limit: 25, totalPages: 0 },
        },
      }),
    });
    signIn(makeSession({ user }));
    renderWithProviders(<App />, { route: '/applications' });

    await screen.findByRole('heading', { name: 'Applications' });
    expect(screen.queryByRole('button', { name: 'Resend link' })).not.toBeInTheDocument();
  });
});
