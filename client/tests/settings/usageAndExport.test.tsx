import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsPage } from '@/pages/SettingsPage';
import { makeSession, makeUser, successBody } from '../utils/factories';
import { installMockApi, type MockApi, type Responder } from '../utils/mockAdapter';
import { renderWithProviders, resetClientState, signIn } from '../utils/render';
import { installThemeTokens, removeThemeTokens } from '../utils/themeTokens';

const USAGE_URL = '/auth/me/usage';
const EXPORT_URL = '/auth/me/export';

function usageBody(overrides: Record<string, unknown> = {}): Responder {
  return () => ({
    status: 200,
    data: successBody({
      applications: { used: 12, limit: 2000, remaining: 1988 },
      storageBytes: { used: 5_242_880, limit: 104_857_600, remaining: 99_614_720 },
      attachmentsPerApplication: { limit: 20 },
      ...overrides,
    }),
  });
}

/**
 * `SessionsSection` fetches on mount too. Answering it keeps its error state off
 * the page, so a "Try again" found here can only be the one this suite is about.
 */
const SESSIONS: Responder = () => ({ status: 200, data: successBody({ sessions: [] }) });

function render(routes: Record<string, Responder> = {}): MockApi {
  const api = installMockApi({
    [`GET ${USAGE_URL}`]: usageBody(),
    'GET /auth/sessions': SESSIONS,
    ...routes,
  });
  signIn(makeSession({ user: makeUser() }));
  renderWithProviders(<SettingsPage />);

  return api;
}

/**
 * jsdom implements neither object URLs nor a download, so both are stubbed and
 * then asserted on: what matters is that the blob the server sent is the blob
 * handed to the browser, under the filename the server chose.
 */
let createdBlobs: Blob[];
let revoked: string[];
let clicked: HTMLAnchorElement[];

beforeEach(() => {
  installThemeTokens();
  createdBlobs = [];
  revoked = [];
  clicked = [];

  URL.createObjectURL = vi.fn((blob: Blob) => {
    createdBlobs.push(blob);
    return `blob:mock/${String(createdBlobs.length)}`;
  });
  URL.revokeObjectURL = vi.fn((url: string) => {
    revoked.push(url);
  });

  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function mockClick(
    this: HTMLAnchorElement,
  ) {
    clicked.push(this);
  });
});

afterEach(() => {
  removeThemeTokens();
  resetClientState();
  vi.restoreAllMocks();
});

describe('the storage and limits section', () => {
  it('reports each quota against the ceiling it is measured by', async () => {
    render();

    // Awaited, not read synchronously: the figures arrive from the server, and
    // the section renders its skeletons until they do.
    expect(await screen.findByText('12 of 2,000')).toBeInTheDocument();

    const section = screen.getByRole('region', { name: 'Storage and limits' });

    expect(within(section).getByText('5.0 MB of 100 MB')).toBeInTheDocument();
    expect(within(section).getByText(/up to 20 attachments/i)).toBeInTheDocument();
  });

  it('says what remains, which is the number a user acts on', async () => {
    render();

    await screen.findByText('12 of 2,000');
    const section = screen.getByRole('region', { name: 'Storage and limits' });

    expect(within(section).getByText(/1,988 remaining/)).toBeInTheDocument();
    expect(within(section).getByText(/95 MB remaining/)).toBeInTheDocument();
  });

  it('shows a skeleton while the figures are loading', () => {
    render();

    // `Skeleton` announces through an sr-only span inside role="status".
    expect(screen.getByText('Loading your usage')).toBeInTheDocument();
  });

  it('offers a retry when the usage call fails', async () => {
    const user = userEvent.setup();
    let attempts = 0;

    const api = render({
      [`GET ${USAGE_URL}`]: () => {
        attempts += 1;
        return attempts === 1 ? { status: 500 } : usageBody()({} as never);
      },
    });

    const section = screen.getByRole('region', { name: 'Storage and limits' });

    await user.click(await within(section).findByRole('button', { name: /try again/i }));

    expect(await screen.findByText('12 of 2,000')).toBeInTheDocument();
    expect(api.callsTo('GET', USAGE_URL)).toHaveLength(2);
  });

  it('reports a nearly full account without pretending it is fine', async () => {
    render({
      [`GET ${USAGE_URL}`]: usageBody({
        applications: { used: 1999, limit: 2000, remaining: 1 },
      }),
    });

    expect(await screen.findByText('1,999 of 2,000')).toBeInTheDocument();

    const section = screen.getByRole('region', { name: 'Storage and limits' });
    expect(within(section).getByText(/1 remaining/)).toBeInTheDocument();
  });
});

describe('exporting everything the account holds', () => {
  const EXPORT_FILE = { profile: { email: 'ada@example.test' }, applications: [] };

  /** Kept by reference: jsdom Blobs have no `.text()`, so identity is the assertion. */
  let sentBlob: Blob;

  function exportResponder(): Responder {
    sentBlob = new Blob([JSON.stringify(EXPORT_FILE)], { type: 'application/json' });

    return () => ({ status: 200, data: sentBlob });
  }

  it('asks the server for the export and hands the file to the browser', async () => {
    const user = userEvent.setup();
    const api = render({ [`GET ${EXPORT_URL}`]: exportResponder() });

    await user.click(await screen.findByRole('button', { name: 'Export' }));

    await waitFor(() => {
      expect(api.callsTo('GET', EXPORT_URL)).toHaveLength(1);
    });

    // The blob the server sent is the blob offered for download, unparsed and
    // un-re-serialised on the way through.
    expect(createdBlobs).toHaveLength(1);
    expect(createdBlobs[0]).toBe(sentBlob);
    // Named by the server, not guessed at by the client.
    expect(clicked).toHaveLength(1);
    expect(clicked[0].download).toBe('internship-tracker-export.json');
  });

  it('goes through the authenticated client, so the request carries the token', async () => {
    const user = userEvent.setup();
    const api = render({ [`GET ${EXPORT_URL}`]: exportResponder() });

    await user.click(await screen.findByRole('button', { name: 'Export' }));

    await waitFor(() => {
      expect(api.callsTo('GET', EXPORT_URL)).toHaveLength(1);
    });

    // A plain link would arrive without this and get a 401, which is why the
    // download is built from a blob rather than pointed at the endpoint.
    expect(api.callsTo('GET', EXPORT_URL)[0].authorization).toMatch(/^Bearer /);
  });

  it('releases the object URL once the download has started', async () => {
    const user = userEvent.setup();
    render({ [`GET ${EXPORT_URL}`]: exportResponder() });

    await user.click(await screen.findByRole('button', { name: 'Export' }));

    await waitFor(() => {
      expect(revoked).toEqual(['blob:mock/1']);
    });
  });

  it('saves nothing at all when the export fails', async () => {
    const user = userEvent.setup();
    const api = render({ [`GET ${EXPORT_URL}`]: () => ({ status: 500 }) });
    const button = await screen.findByRole('button', { name: 'Export' });

    await user.click(button);

    await waitFor(() => {
      expect(api.callsTo('GET', EXPORT_URL)).toHaveLength(1);
    });

    // A half-written or empty file is worse than none: the failure has to end in
    // no download at all. The message itself goes through `Toaster`, which lives
    // in main.tsx and is deliberately not mounted by the test providers.
    expect(createdBlobs).toHaveLength(0);
    expect(clicked).toHaveLength(0);
    // And the button comes back, so the user can retry.
    await waitFor(() => {
      expect(button).toBeEnabled();
    });
  });

  it('is still retryable after a rate-limited attempt', async () => {
    const user = userEvent.setup();
    let attempts = 0;

    const api = render({
      [`GET ${EXPORT_URL}`]: (request) => {
        attempts += 1;

        if (attempts === 1) {
          return {
            status: 429,
            data: {
              success: false,
              code: 'RATE_LIMITED_EXPORT',
              message: 'You have requested several exports recently. Try again in an hour.',
            },
          };
        }

        return exportResponder()(request);
      },
    });

    const button = await screen.findByRole('button', { name: 'Export' });

    await user.click(button);
    await waitFor(() => {
      expect(createdBlobs).toHaveLength(0);
    });

    await user.click(button);
    await waitFor(() => {
      expect(createdBlobs).toHaveLength(1);
    });

    expect(api.callsTo('GET', EXPORT_URL)).toHaveLength(2);
  });
});
