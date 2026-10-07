import { Seo } from '@/components/Seo';
import { useCallback, useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { VerificationBanner } from '@/features/auth/VerificationBanner';
import { Sidebar } from '@/components/layout/Sidebar';
import { Topbar } from '@/components/layout/Topbar';
import { cn } from '@/lib/cn';
import { paths } from '@/routes/paths';

/**
 * The application shell: a static sidebar from `lg` up, an off-canvas drawer
 * below it, and a main column that stays usable at 375 px. Phase 6 and 7 fill the
 * outlet with content that scrolls inside itself, so the shell never has to.
 */
/**
 * Per-route title and description for the authenticated shell, per SPEC section
 * 12. One table rather than a `<Seo>` in each page: every one of these routes
 * renders into this layout, so this is the single place they can all be given a
 * title without five near-identical edits.
 */
const ROUTE_META: { prefix: string; title: string; description: string }[] = [
  {
    prefix: '/applications/board',
    title: 'Board',
    description: 'Your applications as a Kanban board, from saved through to offer.',
  },
  {
    prefix: '/applications/calendar',
    title: 'Calendar',
    description: 'Deadlines and interviews on a month view, in your own timezone.',
  },
  {
    prefix: '/applications',
    title: 'Applications',
    description:
      'Every application you are tracking, with filters for status, source, priority and deadline.',
  },
  {
    prefix: '/settings',
    title: 'Settings',
    description:
      'Your profile, preferences, email settings, signed-in devices and account controls.',
  },
  {
    prefix: '/dashboard',
    title: 'Dashboard',
    description:
      'Your internship search at a glance: applications sent, response rate, interviews, and what is due next.',
  },
];

const FALLBACK_META = ROUTE_META[ROUTE_META.length - 1];

/** Longest-prefix match, so `/applications/board` never resolves as `/applications`. */
function routeMeta(pathname: string): { title: string; description: string } {
  return ROUTE_META.find((entry) => pathname.startsWith(entry.prefix)) ?? FALLBACK_META;
}

export function AppLayout(): JSX.Element {
  const meta = routeMeta(useLocation().pathname);

  const [isNavOpen, setIsNavOpen] = useState(false);
  const location = useLocation();

  const closeNav = useCallback(() => {
    setIsNavOpen(false);
  }, []);

  // Following a link inside the drawer must dismiss it, or the destination is
  // hidden behind the overlay on a phone.
  useEffect(closeNav, [location.pathname, closeNav]);

  /*
   * The board is given exactly the height left under the top bar, the banner
   * and its own header, so its sideways scrollbar sits on screen rather than
   * under columns as tall as their longest list. A flex column rather than a
   * calc() because the banner and the board's "Showing 100 of N" line come and
   * go. `svh` is the height with the browser's toolbars showing, so nothing is
   * cut off under them. Only from `board-fit` up: below it the page flows as
   * before, and there is no nested scroll to trap a phone.
   */
  const fillsViewport = location.pathname.startsWith(paths.board);

  return (
    <div className="min-h-screen bg-canvas">
      <Seo title={meta.title} description={meta.description} />

      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-control focus:bg-surface focus:px-4 focus:py-2 focus:text-sm focus:text-content"
      >
        Skip to main content
      </a>

      <Sidebar isOpen={isNavOpen} onClose={closeNav} />

      <div
        className={cn(
          'lg:pl-64',
          fillsViewport && 'board-fit:flex board-fit:h-svh board-fit:flex-col',
        )}
      >
        <Topbar
          isNavOpen={isNavOpen}
          onOpenNav={() => {
            setIsNavOpen(true);
          }}
        />

        {/* App wide, not per page: an unverified account is a property of the
            session, and burying the notice on one route would let someone spend
            a week never seeing it. */}
        <VerificationBanner />

        <main
          id="main-content"
          className={cn(
            'mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8',
            fillsViewport && 'board-fit:flex board-fit:min-h-0 board-fit:flex-1 board-fit:flex-col',
          )}
        >
          <Outlet />
        </main>
      </div>
    </div>
  );
}
