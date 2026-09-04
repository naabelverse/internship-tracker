import { useCallback, useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { VerificationBanner } from '@/features/auth/VerificationBanner';
import { Sidebar } from '@/components/layout/Sidebar';
import { Topbar } from '@/components/layout/Topbar';

/**
 * The application shell: a static sidebar from `lg` up, an off-canvas drawer
 * below it, and a main column that stays usable at 375 px. Phase 6 and 7 fill the
 * outlet with content that scrolls inside itself, so the shell never has to.
 */
export function AppLayout(): JSX.Element {
  const [isNavOpen, setIsNavOpen] = useState(false);
  const location = useLocation();

  const closeNav = useCallback(() => {
    setIsNavOpen(false);
  }, []);

  // Following a link inside the drawer must dismiss it, or the destination is
  // hidden behind the overlay on a phone.
  useEffect(closeNav, [location.pathname, closeNav]);

  return (
    <div className="min-h-screen bg-canvas">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-control focus:bg-surface focus:px-4 focus:py-2 focus:text-sm focus:text-content"
      >
        Skip to main content
      </a>

      <Sidebar isOpen={isNavOpen} onClose={closeNav} />

      <div className="lg:pl-64">
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

        <main id="main-content" className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
