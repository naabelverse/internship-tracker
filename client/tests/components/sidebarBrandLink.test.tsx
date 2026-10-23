import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppLayout } from '@/components/layout/AppLayout';
import { Sidebar } from '@/components/layout/Sidebar';
import { APP_VERSION, AUTHOR_URL } from '@/lib/siteMeta';
import { paths } from '@/routes/paths';
import { makeSession } from '../utils/factories';
import { installMockApi } from '../utils/mockAdapter';
import { renderWithProviders, resetClientState, signIn } from '../utils/render';

/**
 * The app shell's lockup lives at the top of the sidebar, as the first stop in
 * the navigation block, and links to the dashboard. The landing page would
 * work too, but `/` redirects a signed-in visitor to the dashboard, so linking
 * there directly skips the hop. The topbar carries only session controls.
 */

beforeEach(() => {
  installMockApi({});
  signIn(makeSession());
});

afterEach(() => {
  resetClientState();
});

function lockup(): HTMLElement {
  // The mark is `aria-hidden`, so the wordmark alone names the link, the same
  // name the marketing header's and auth pages' logos carry.
  return within(screen.getByLabelText('Main navigation')).getByRole('link', {
    name: 'Internship Tracker',
  });
}

/** The shell with stand-in pages, so a click proves where the link lands. */
function renderShellAt(route: string): void {
  renderWithProviders(
    <Routes>
      <Route element={<AppLayout />}>
        <Route path={paths.dashboard} element={<h1>Dashboard page</h1>} />
        <Route path={paths.applications} element={<h1>Applications page</h1>} />
      </Route>
    </Routes>,
    { route },
  );
}

describe('the sidebar lockup', () => {
  it('links both the mark and the wordmark to the dashboard', () => {
    renderWithProviders(<Sidebar isOpen={false} onClose={() => undefined} />);

    const logo = lockup();

    expect(logo).toHaveAttribute('href', paths.dashboard);
    expect(logo.querySelector('svg')).not.toBeNull();
    expect(logo).toHaveTextContent('Internship Tracker');
  });

  it('sits above the nav items, not in a separate bordered band', () => {
    renderWithProviders(<Sidebar isOpen={false} onClose={() => undefined} />);

    const logo = lockup();
    const nav = screen.getByRole('navigation', { name: 'Sections' });

    expect(logo.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // jsdom applies no CSS, so this pins the class contract only; the rendered
    // result was measured in a real browser for the PR. The border is what made
    // the row read as the left end of the topbar.
    expect(logo.parentElement?.className).not.toMatch(/\bborder-b\b/);
  });

  it('closes the drawer when followed, even from the dashboard itself', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderWithProviders(<Sidebar isOpen onClose={onClose} />, { route: paths.dashboard });

    // From the dashboard the pathname does not change, so the shell's route
    // effect never fires; without the link's own `onClose` the drawer would
    // stay open over the page on a phone.
    await user.click(lockup());

    expect(onClose).toHaveBeenCalled();
  });

  it('reaches the dashboard from another page', async () => {
    const user = userEvent.setup();
    renderShellAt(paths.applications);

    await user.click(lockup());

    expect(await screen.findByRole('heading', { name: 'Dashboard page' })).toBeInTheDocument();
  });

  it('ends with a feedback button, the author credit and the version', () => {
    renderWithProviders(<Sidebar isOpen={false} onClose={() => undefined} />);
    const panel = within(screen.getByLabelText('Main navigation'));

    expect(panel.getByRole('link', { name: 'Naabel' })).toHaveAttribute('href', AUTHOR_URL);
    expect(panel.getByRole('button', { name: 'Send feedback' })).toBeInTheDocument();
    expect(panel.getByText(`v${APP_VERSION}`)).toBeInTheDocument();
  });

  it('appears once in the shell, and not in the topbar', () => {
    renderShellAt(paths.dashboard);

    expect(screen.getAllByRole('link', { name: 'Internship Tracker' })).toHaveLength(1);
    expect(
      within(screen.getByRole('banner')).queryByRole('link', { name: 'Internship Tracker' }),
    ).not.toBeInTheDocument();
  });
});
