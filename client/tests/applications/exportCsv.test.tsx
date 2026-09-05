import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '@/App';
import { errorBody, makeApplication, makeListResponse, makeSession } from '../utils/factories';
import { installMockApi, type MockApi, type Responder } from '../utils/mockAdapter';
import { renderWithProviders, resetClientState, signIn } from '../utils/render';

/**
 * The CSV export, which SPEC section 17's manual pass ends with and section 10's
 * sixth end-to-end flow downloads.
 *
 * Phase 15 found `GET /applications/export` had existed since Phase 4 with
 * nothing in the UI calling it, so a user could not walk that flow at all. These
 * cases pin the control to the endpoint: the right URL, the right format, the
 * blob the server sent handed to the browser under the name the server chose,
 * and a refusal that ends in no file rather than a truncated one.
 */

const LIST = 'GET /applications';
const EXPORT_URL = '/applications/export';

const rows = [makeApplication({ id: 'app-1', company: 'Stripe', role: 'Backend Intern' })];

function render(routes: Record<string, Responder> = {}): MockApi {
  const api = installMockApi({
    [LIST]: () => ({ status: 200, data: makeListResponse(rows, { total: 1 }) }),
    ...routes,
  });
  signIn(makeSession());
  renderWithProviders(<App />, { route: '/applications' });

  return api;
}

/** jsdom implements neither object URLs nor a download, so both are stubbed. */
let createdBlobs: Blob[];
let revoked: string[];
let clicked: HTMLAnchorElement[];

beforeEach(() => {
  resetClientState();
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
  vi.restoreAllMocks();
  resetClientState();
});

describe('exporting the applications list as CSV', () => {
  it('is offered from the toolbar', async () => {
    render();

    expect(await screen.findByRole('button', { name: 'Export CSV' })).toBeInTheDocument();
  });

  it('asks the export endpoint for the CSV format', async () => {
    const user = userEvent.setup();
    const api = render({
      [`GET ${EXPORT_URL}`]: () => ({ status: 200, data: new Blob(['company,role\n']) }),
    });

    await user.click(await screen.findByRole('button', { name: 'Export CSV' }));

    await waitFor(() => {
      expect(api.callsTo('GET', EXPORT_URL)).toHaveLength(1);
    });
    expect(api.callsTo('GET', EXPORT_URL)[0]?.params).toEqual({ format: 'csv' });
  });

  it('hands the browser the blob the server sent, under a .csv name', async () => {
    const user = userEvent.setup();
    const body = new Blob(['company,role\nStripe,Backend Intern\n'], { type: 'text/csv' });
    render({ [`GET ${EXPORT_URL}`]: () => ({ status: 200, data: body }) });

    await user.click(await screen.findByRole('button', { name: 'Export CSV' }));

    await waitFor(() => {
      expect(clicked).toHaveLength(1);
    });
    expect(createdBlobs).toEqual([body]);
    // The server names the file through `Content-Disposition`. The mock adapter
    // sends no headers, so this is the fallback — which still has to carry the
    // extension, or the download lands with no type at all.
    expect(clicked[0]?.download).toBe('applications.csv');
    expect(clicked[0]?.href).toBe('blob:mock/1');

    // Revoked on the next tick rather than synchronously, so the download is not
    // racing a dead URL.
    await waitFor(() => {
      expect(revoked).toEqual(['blob:mock/1']);
    });
  });

  it('saves nothing at all when the export is refused', async () => {
    const user = userEvent.setup();
    const api = render({
      [`GET ${EXPORT_URL}`]: () => ({
        status: 429,
        data: errorBody('Too many exports in a short time.', 'RATE_LIMITED_EXPORT'),
      }),
    });
    const button = await screen.findByRole('button', { name: 'Export CSV' });

    await user.click(button);

    await waitFor(() => {
      expect(api.callsTo('GET', EXPORT_URL)).toHaveLength(1);
    });

    // A truncated file is worse than no file. The message itself goes through
    // `Toaster`, which lives in main.tsx and is deliberately not mounted here.
    expect(createdBlobs).toHaveLength(0);
    expect(clicked).toHaveLength(0);
    // And the control comes back, so the user can retry.
    await waitFor(() => {
      expect(button).toBeEnabled();
    });
  });
});
