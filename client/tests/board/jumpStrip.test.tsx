import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '@/App';
import { STATUS_CONFIG } from '@/lib/statusConfig';
import { APPLICATION_STATUSES } from '@/types/application';
import { makeApplication, makeListResponse, makeSession } from '../utils/factories';
import { installMockApi } from '../utils/mockAdapter';
import { renderWithProviders, resetClientState, signIn, waitForRoute } from '../utils/render';

/** Where a column sits in jsdom, which lays nothing out: 300 px per column. */
const COLUMN_STEP = 300;

interface ScrollCall {
  target: Element;
  options: ScrollToOptions | number | undefined;
}

let scrollCalls: ScrollCall[] = [];
const originalScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo');

async function renderBoard(): Promise<void> {
  const rows = [
    makeApplication({ status: 'applied' }),
    makeApplication({ status: 'applied' }),
    makeApplication({ status: 'offer' }),
  ];
  installMockApi({
    'GET /applications': () => ({ status: 200, data: makeListResponse(rows) }),
  });
  signIn(makeSession());
  renderWithProviders(<App />, { route: '/applications/board' });
  // The board route is lazy, so the page mounts a microtask after render.
  await waitForRoute();
  await screen.findByTestId('kanban-board');
}

function strip(): HTMLElement {
  return screen.getByRole('navigation', { name: 'Jump to column' });
}

/** Answers `prefers-reduced-motion: reduce` as an OS with reduced motion on would. */
function stubReducedMotion(): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query.includes('prefers-reduced-motion: reduce'),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

beforeEach(() => {
  resetClientState();
  scrollCalls = [];
  HTMLElement.prototype.scrollTo = function scrollTo(
    this: HTMLElement,
    options?: ScrollToOptions | number,
  ): void {
    scrollCalls.push({ target: this, options });
  };
  vi.spyOn(HTMLElement.prototype, 'offsetLeft', 'get').mockImplementation(function offsetLeft(
    this: HTMLElement,
  ) {
    return Number(this.getAttribute('data-column-index') ?? 0) * COLUMN_STEP;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (originalScrollTo) {
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', originalScrollTo);
  } else {
    delete (HTMLElement.prototype as { scrollTo?: unknown }).scrollTo;
  }
  resetClientState();
});

/**
 * The row above the board that names every column, so the four a 1440 px window
 * cannot show are no longer invisible, and takes the board straight to one.
 */
describe('board jump strip', () => {
  it('names every column with its count, in board order', async () => {
    await renderBoard();

    const counts: Record<string, number> = { applied: 2, offer: 1 };
    const expected = APPLICATION_STATUSES.map(
      (status) => `${STATUS_CONFIG[status].label} ${String(counts[status] ?? 0)} applications`,
    );

    expect(
      within(strip())
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(expected);
    // The space is in the accessible name as well as the text: "Offer 1", not "Offer1".
    expect(within(strip()).getByRole('button', { name: 'Offer 1 applications' })).toBeVisible();
  });

  it('scrolls the board, not the page, to the column, and leaves focus on the button', async () => {
    const user = userEvent.setup();
    await renderBoard();

    const offer = within(strip()).getByRole('button', { name: /^Offer/ });
    await user.click(offer);

    expect(scrollCalls).toEqual([
      {
        target: screen.getByTestId('kanban-board'),
        options: { left: 4 * COLUMN_STEP, behavior: 'smooth' },
      },
    ]);
    expect(offer).toHaveFocus();
  });

  it('jumps without the smooth scroll when reduced motion is asked for', async () => {
    stubReducedMotion();
    const user = userEvent.setup();
    await renderBoard();

    await user.click(within(strip()).getByRole('button', { name: /^Withdrawn/ }));

    expect(scrollCalls.map((call) => call.options)).toEqual([
      { left: 7 * COLUMN_STEP, behavior: 'auto' },
    ]);
  });
});
