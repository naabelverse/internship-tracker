import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '@/App';
import ApplicationDetailPage from '@/pages/ApplicationDetailPage';
import {
  errorBody,
  makeApplication,
  makeAttachment,
  makeInterview,
  makeSession,
} from '../utils/factories';
import { createGate, installMockApi, type MockApi, type Responder } from '../utils/mockAdapter';
import { renderWithProviders, resetClientState, signIn } from '../utils/render';

const ID = 'app-1';
const DETAIL = `GET /applications/${ID}`;
const PATCH = `PATCH /applications/${ID}`;

const application = makeApplication({
  id: ID,
  company: 'Stripe',
  role: 'Backend Intern',
  status: 'interview',
  notes: 'Recruiter call went well.',
  statusHistory: [
    { from: null, to: 'saved', changedAt: '2026-01-01T09:00:00.000Z' },
    { from: 'saved', to: 'applied', changedAt: '2026-01-05T09:00:00.000Z', note: 'Sent CV v3' },
  ],
  interviews: [makeInterview({ id: 'int-1', scheduledAt: '2026-01-03T09:00:00.000Z' })],
  attachments: [makeAttachment({ id: 'att-1', originalName: 'cv.pdf', size: 2048 })],
});

const detailResponse = () => ({
  status: 200,
  data: { success: true, data: { application } },
});

function renderDetail(routes: Record<string, Responder> = {}): MockApi {
  const mock = installMockApi({ [DETAIL]: detailResponse, ...routes });
  signIn(makeSession());
  renderWithProviders(<App />, { route: `/applications/${ID}` });

  return mock;
}

beforeEach(() => {
  resetClientState();
});

afterEach(() => {
  vi.useRealTimers();
  resetClientState();
});

describe('detail page', () => {
  it('shows a skeleton before the document arrives', async () => {
    // The page is rendered directly rather than through `<App />`. Since Phase 13
    // this route is lazy, so going through the router would race the chunk load
    // against the request; this case is about the page's own loading state. The
    // response is gated so that state persists long enough to observe.
    const gate = createGate();
    installMockApi({
      [DETAIL]: async () => {
        await gate.wait;
        return detailResponse();
      },
    });
    signIn(makeSession());

    renderWithProviders(<ApplicationDetailPage />, { route: `/applications/${ID}` });

    expect(await screen.findByTestId('detail-skeleton')).toBeInTheDocument();

    gate.open();
  });

  it('shows an error state with a retry when the document fails to load', async () => {
    renderDetail({
      [DETAIL]: () => ({ status: 404, data: errorBody('Resource not found', 'NOT_FOUND') }),
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('That did not load');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('renders the header with the quick actions', async () => {
    renderDetail();

    expect(await screen.findByRole('heading', { level: 1, name: 'Stripe' })).toBeInTheDocument();
    expect(screen.getByLabelText('Application status')).toHaveValue('interview');
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Interview' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Archive/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete application' })).toBeInTheDocument();
  });
});

describe('timeline', () => {
  it('merges status history and interviews into one list, newest first', async () => {
    renderDetail();

    const timeline = await screen.findByTestId('application-timeline');
    const entries = within(timeline).getAllByRole('listitem');

    expect(entries).toHaveLength(3);
    expect(entries[0]).toHaveTextContent('Saved to Applied');
    expect(entries[1]).toHaveTextContent('Technical interview');
    expect(entries[2]).toHaveTextContent('Added as Saved');
  });

  it('carries the note recorded with a status change', async () => {
    renderDetail();

    const timeline = await screen.findByTestId('application-timeline');
    expect(timeline).toHaveTextContent('Sent CV v3');
  });
});

describe('attachments', () => {
  it('lists what is already attached', async () => {
    renderDetail();

    expect(await screen.findByText('cv.pdf')).toBeInTheDocument();
    expect(screen.getByText(/2\.0 KB/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove cv.pdf' })).toBeInTheDocument();
  });

  it('rejects an unsupported type before any request is made', async () => {
    // The input carries an `accept` list, which userEvent honours by default.
    // Bypassing it is the point: this asserts the app's own guard rather than the
    // file picker's filter, which a drag and drop would never apply.
    const user = userEvent.setup({ applyAccept: false });
    const mock = renderDetail();
    await screen.findByText('cv.pdf');

    await user.upload(
      screen.getByLabelText('Attachment file'),
      new File(['x'], 'notes.txt', { type: 'text/plain' }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Only PDF, DOC, DOCX, PNG and JPG files can be attached.',
    );
    expect(mock.callsTo('POST', `/applications/${ID}/attachments`)).toHaveLength(0);
  });

  it('rejects a file over the 5 MB limit before any request is made', async () => {
    const user = userEvent.setup();
    const mock = renderDetail();
    await screen.findByText('cv.pdf');

    const tooBig = new File(['x'], 'big.pdf', { type: 'application/pdf' });
    Object.defineProperty(tooBig, 'size', { value: 6 * 1024 * 1024 });

    await user.upload(screen.getByLabelText('Attachment file'), tooBig);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That file is larger than the 5 MB limit.',
    );
    expect(mock.callsTo('POST', `/applications/${ID}/attachments`)).toHaveLength(0);
  });

  it('uploads a file the limits allow', async () => {
    const user = userEvent.setup();
    const mock = renderDetail({
      [`POST /applications/${ID}/attachments`]: () => ({
        status: 201,
        data: { success: true, data: { application } },
      }),
    });
    await screen.findByText('cv.pdf');

    await user.upload(
      screen.getByLabelText('Attachment file'),
      new File(['x'], 'cover.pdf', { type: 'application/pdf' }),
    );

    await waitFor(() => {
      expect(mock.callsTo('POST', `/applications/${ID}/attachments`)).toHaveLength(1);
    });
  });
});

describe('notes autosave', () => {
  it('does not save when the text ends up back at what was saved', async () => {
    const user = userEvent.setup();
    const mock = renderDetail({ [PATCH]: detailResponse });

    const editor = await screen.findByDisplayValue('Recruiter call went well.');
    await user.type(editor, '!');
    await user.keyboard('{Backspace}');

    // Wrapped in act because the wait exists precisely so the autosave timer can
    // fire; the state update it causes belongs inside React's batching window.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1200));
    });

    expect(mock.callsTo('PATCH', `/applications/${ID}`)).toHaveLength(0);
  });

  it('saves once the debounce settles on a genuine edit', async () => {
    const user = userEvent.setup();
    const mock = renderDetail({ [PATCH]: detailResponse });

    const editor = await screen.findByDisplayValue('Recruiter call went well.');
    await user.type(editor, ' Prep system design.');

    await waitFor(
      () => {
        expect(mock.callsTo('PATCH', `/applications/${ID}`)).toHaveLength(1);
      },
      { timeout: 3000 },
    );

    const body = mock.callsTo('PATCH', `/applications/${ID}`)[0].data as Record<string, unknown>;
    expect(body.notes).toBe('Recruiter call went well. Prep system design.');
  });

  it('renders the markdown preview without executing embedded HTML', async () => {
    const user = userEvent.setup();
    const unsafe = '# Heading\n\n[bad](javascript:alert(1))\n\n<img src=x onerror="alert(1)">';

    renderDetail({
      [DETAIL]: () => ({
        status: 200,
        data: { success: true, data: { application: { ...application, notes: unsafe } } },
      }),
    });

    await screen.findByRole('heading', { level: 1, name: 'Stripe' });
    await user.click(screen.getByRole('tab', { name: 'Preview' }));

    const preview = screen.getByTestId('notes-preview');
    expect(preview.querySelector('h1')).toHaveTextContent('Heading');
    expect(preview.querySelector('img')).toBeNull();
    expect(preview.innerHTML).not.toContain('javascript:');
    expect(preview.innerHTML).not.toContain('onerror');
  });
});
