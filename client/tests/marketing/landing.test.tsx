import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from '@/App';
import { EVENT_KIND_CONFIG, STATUS_CONFIG } from '@/lib/statusConfig';
import { paths } from '@/routes/paths';
import type { CalendarEvent } from '@/types/calendar';
import { errorBody, makeSession, makeUser, successBody } from '../utils/factories';
import { installMockApi } from '../utils/mockAdapter';
import { renderWithProviders, resetClientState, signIn } from '../utils/render';

/**
 * The public landing page, per SPEC section 12.
 *
 * Everything here is driven through `<App />` rather than by rendering
 * `LandingPage` directly, because half of what this phase added is *routing*:
 * who sees the marketing page and who is sent past it.
 */

const DEMO = 'POST /auth/demo';
const HERO = /never miss a deadline/i;

beforeEach(() => {
  resetClientState();
});

afterEach(() => {
  resetClientState();
});

describe('the landing page', () => {
  it('greets a logged-out visitor with the value proposition', async () => {
    installMockApi({});

    renderWithProviders(<App />, { route: paths.landing });

    expect(await screen.findByRole('heading', { level: 1, name: HERO })).toBeInTheDocument();
  });

  it('offers every section SPEC section 12 asks for', async () => {
    installMockApi({});

    renderWithProviders(<App />, { route: paths.landing });
    await screen.findByRole('heading', { level: 1, name: HERO });

    expect(
      screen.getByRole('heading', { name: /the spreadsheet was missing/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /on one screen/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'How it works' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Questions people ask' })).toBeInTheDocument();
  });

  it('shows between three and six feature cards', async () => {
    installMockApi({});

    renderWithProviders(<App />, { route: paths.landing });
    const heading = await screen.findByRole('heading', { name: /the spreadsheet was missing/i });
    const cards = heading.parentElement?.querySelectorAll('ul > li') ?? [];

    expect(cards.length).toBeGreaterThanOrEqual(3);
    expect(cards.length).toBeLessThanOrEqual(6);
  });

  it('gives every feature card the same cell, so no row is left with one card in it', async () => {
    installMockApi({});

    renderWithProviders(<App />, { route: paths.landing });
    const heading = await screen.findByRole('heading', { name: /the spreadsheet was missing/i });
    const grid = heading.parentElement?.querySelector('ul') as HTMLElement;
    const cards = [...grid.querySelectorAll(':scope > li')];

    // The regression: cells spanned 7/5, 4/4/4 and then 12, which stranded the
    // shortest card alone in a full-width row. Equal columns that divide the
    // card count leave every row full at both breakpoints.
    expect(grid).toHaveClass('sm:grid-cols-2', 'lg:grid-cols-3');
    expect(cards.length % 2).toBe(0);
    expect(cards.length % 3).toBe(0);
    for (const card of cards) {
      expect(card.className).not.toMatch(/col-span/);
    }
  });

  it('links Terms, Privacy, the repository and a contact address from the footer', async () => {
    installMockApi({});

    renderWithProviders(<App />, { route: paths.landing });
    await screen.findByRole('heading', { level: 1, name: HERO });

    expect(screen.getByRole('link', { name: 'Terms of Service' })).toHaveAttribute(
      'href',
      paths.terms,
    );
    expect(screen.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute(
      'href',
      paths.privacy,
    );
    expect(screen.getByRole('link', { name: 'GitHub' }).getAttribute('href')).toContain(
      'github.com',
    );
    expect(screen.getByRole('link', { name: 'Contact' }).getAttribute('href')).toContain('mailto:');
  });

  it('carries a screenshot with real alternative text, not a filename', async () => {
    installMockApi({});

    renderWithProviders(<App />, { route: paths.landing });
    const images = await screen.findAllByRole('img', { name: /dashboard/i });

    expect(images.map((image) => image.getAttribute('src'))).toEqual([
      '/screenshot-dashboard-light.png',
      '/screenshot-dashboard-dark.png',
    ]);
    for (const image of images) {
      expect(image.getAttribute('alt')?.length ?? 0).toBeGreaterThan(40);
      // Below the fold, so it must not compete with the hero for bandwidth.
      expect(image).toHaveAttribute('loading', 'lazy');
    }
  });

  it('shows the screenshot matching the active theme, keyed off data-theme', async () => {
    installMockApi({});

    renderWithProviders(<App />, { route: paths.landing });
    const [light, dark] = await screen.findAllByRole('img', { name: /dashboard/i });

    // jsdom applies no CSS, so this pins the class contract: `dark:` resolves
    // against `[data-theme="dark"]` (tailwind.config.ts), which the theme
    // control sets, so exactly one of the pair is displayed in either theme.
    expect(light).toHaveClass('block', 'dark:hidden');
    expect(dark).toHaveClass('hidden', 'dark:block');
  });
});

describe("the hero's example panel", () => {
  it('marks each row by event type, painted as the dashboard paints it', async () => {
    installMockApi({});

    renderWithProviders(<App />, { route: paths.landing });
    const panel = (await screen.findByText('Next up')).closest('figure') as HTMLElement;
    const dots = [...panel.querySelectorAll<HTMLElement>('[data-event-dot]')];

    expect(dots).toHaveLength(panel.querySelectorAll('[data-upcoming-row]').length);

    for (const dot of dots) {
      const kind = EVENT_KIND_CONFIG[dot.dataset.eventDot as CalendarEvent['kind']];

      expect(dot).toHaveClass(kind.dot);
      expect(dot.parentElement).toHaveTextContent(kind.label);
    }

    // The regression: the panel used to paint an interview with the Interview
    // *status* colour, amber, where the dashboard's upcoming panel paints it blue.
    expect(panel.querySelector('[data-event-dot="interview"]')).not.toHaveClass(
      STATUS_CONFIG.interview.dot,
    );
  });

  it("draws every row with the dashboard's own row, dated rather than told its urgency", async () => {
    installMockApi({});

    renderWithProviders(<App />, { route: paths.landing });
    const panel = (await screen.findByText('Next up')).closest('figure') as HTMLElement;
    // The first list is the rows; the dot key below the card is the second.
    const items = within(within(panel).getAllByRole('list')[0]).getAllByRole('listitem');

    // One UpcomingRow per item: a hand-built row here is what drifted before.
    for (const item of items) {
      expect(item.querySelectorAll('[data-upcoming-row]')).toHaveLength(1);
    }
    // An example has nowhere to go, so none of it is a link.
    expect(within(panel).queryByRole('link')).toBeNull();

    // The amber comes from the date: the first example is two days out.
    const first = within(items[0]).getByText('in 2 days');
    expect(first).toHaveClass('text-warning');
    expect(within(items[1]).getByText('in 4 days')).toHaveClass('text-content-subtle');
  });

  it('names both warm colours in its caption, because the panel paints with both', async () => {
    installMockApi({});

    renderWithProviders(<App />, { route: paths.landing });
    const panel = (await screen.findByText('Next up')).closest('figure') as HTMLElement;

    expect(panel.querySelector('.text-warning')).not.toBeNull();
    expect(panel.querySelector('.bg-danger')).not.toBeNull();
    // The caption used to say amber was the only colour that meant hurry,
    // beside a red deadline dot and in an app that paints overdue dates red.
    const caption = panel.querySelector('figcaption');
    expect(caption).toHaveTextContent(/amber and red mean it needs attention/i);
    expect(caption).not.toHaveTextContent(/only/i);
  });

  it('keys its dots by event type, not by application status', async () => {
    installMockApi({});

    renderWithProviders(<App />, { route: paths.landing });
    const panel = (await screen.findByText('Next up')).closest('figure') as HTMLElement;
    const key = within(panel).getByRole('list', { name: 'What the dots mean' });
    const entries = within(key).getAllByRole('listitem');

    expect(entries).toHaveLength(Object.keys(EVENT_KIND_CONFIG).length);

    for (const [kind, config] of Object.entries(EVENT_KIND_CONFIG)) {
      const entry = within(key).getByText(config.label);

      expect(entry.querySelector('[aria-hidden="true"]')).toHaveClass(config.dot);
      expect(panel.querySelector(`[data-event-dot="${kind}"]`)).toHaveClass(config.dot);
    }
  });

  it('carries no status legend anywhere on the page to read the dots against', async () => {
    installMockApi({});

    const { container } = renderWithProviders(<App />, { route: paths.landing });
    await screen.findByText('Next up');

    // The eight-status rail at the foot of the hero said blue was Applied and
    // amber was Interview, while the panel above it paints an interview blue.
    // Nothing on this page shows a status, so no status swatch belongs on it.
    expect(container.querySelector('[data-status-dot]')).toBeNull();
    expect(screen.queryByText(STATUS_CONFIG.withdrawn.label)).toBeNull();
    expect(screen.queryByText(STATUS_CONFIG.ghosted.label)).toBeNull();
  });
});

describe('the FAQ accordion', () => {
  it('opens and closes an answer, reporting its state', async () => {
    const user = userEvent.setup();
    installMockApi({});

    renderWithProviders(<App />, { route: paths.landing });
    await screen.findByRole('heading', { name: 'Questions people ask' });

    const question = screen.getByRole('button', { name: /really free/i });
    expect(question).toHaveAttribute('aria-expanded', 'true');

    await user.click(question);
    expect(question).toHaveAttribute('aria-expanded', 'false');

    await user.click(question);
    expect(question).toHaveAttribute('aria-expanded', 'true');
  });

  it('shows one answer at a time', async () => {
    const user = userEvent.setup();
    installMockApi({});

    renderWithProviders(<App />, { route: paths.landing });
    await screen.findByRole('heading', { name: 'Questions people ask' });

    const first = screen.getByRole('button', { name: /really free/i });
    const second = screen.getByRole('button', { name: /sign up to look around/i });

    await user.click(second);

    expect(second).toHaveAttribute('aria-expanded', 'true');
    expect(first).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('who sees the landing page', () => {
  it('sends a signed-in visitor straight to the dashboard', async () => {
    installMockApi({});
    signIn(makeSession({ user: makeUser() }));

    renderWithProviders(<App />, { route: paths.landing });

    // The redirect lives in `MarketingRoute` alone, so this is the whole of SPEC
    // section 12's "logged-in users hitting / go straight to the dashboard".
    expect(await screen.findByText('Skip to main content')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1, name: HERO })).toBeNull();
  });

  it('still renders for a visitor whose session is not yet known', async () => {
    // A cold load leaves the session `pending` until the silent refresh answers.
    // A marketing page must paint anyway: this is the largest paint a crawler and
    // a first-time visitor both see, and a skeleton there would *be* the content.
    installMockApi({
      'POST /auth/refresh': () => ({
        status: 401,
        data: errorBody('No session', 'UNAUTHENTICATED'),
      }),
    });

    renderWithProviders(<App />, { route: paths.landing });

    expect(await screen.findByRole('heading', { level: 1, name: HERO })).toBeInTheDocument();
  });
});

describe('Try the demo', () => {
  it('signs the visitor in and lands them on the dashboard', async () => {
    const user = userEvent.setup();
    const session = makeSession({ user: makeUser({ name: 'Demo Student' }) });
    const api = installMockApi({ [DEMO]: () => ({ status: 200, data: successBody(session) }) });

    renderWithProviders(<App />, { route: paths.landing });
    await screen.findByRole('heading', { level: 1, name: HERO });

    await user.click(screen.getByRole('button', { name: 'Try the demo' }));

    await waitFor(() => {
      expect(api.callsTo('POST', '/auth/demo')).toHaveLength(1);
    });
    // Landing on the authenticated shell is the observable outcome; the
    // dashboard's own content belongs to the dashboard suite.
    expect(await screen.findByText('Skip to main content')).toBeInTheDocument();
  });

  it('sends no body, so the route cannot be aimed at another account', async () => {
    const user = userEvent.setup();
    const session = makeSession({ user: makeUser() });
    const api = installMockApi({ [DEMO]: () => ({ status: 200, data: successBody(session) }) });

    renderWithProviders(<App />, { route: paths.landing });
    await screen.findByRole('heading', { level: 1, name: HERO });
    await user.click(screen.getByRole('button', { name: 'Try the demo' }));

    await waitFor(() => {
      expect(api.callsTo('POST', '/auth/demo')).toHaveLength(1);
    });
    expect(api.callsTo('POST', '/auth/demo')[0].data).toBeUndefined();
  });

  it('says so plainly when the deployment has no demo account', async () => {
    const user = userEvent.setup();
    installMockApi({
      [DEMO]: () => ({
        status: 404,
        data: errorBody(
          'The demo account is not available on this deployment.',
          'DEMO_UNAVAILABLE',
        ),
      }),
    });

    renderWithProviders(<App />, { route: paths.landing });
    await screen.findByRole('heading', { level: 1, name: HERO });
    await user.click(screen.getByRole('button', { name: 'Try the demo' }));

    // The failure is reported through a toast, and `Toaster` lives in main.tsx
    // rather than in the test tree. What is assertable here is the part that
    // matters: a refused demo leaves the visitor on the landing page rather
    // than in a half-signed-in state.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Try the demo' })).toBeEnabled();
    });
    expect(screen.getByRole('heading', { level: 1, name: HERO })).toBeInTheDocument();
  });
});
