import { useRef } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { cn } from '@/lib/cn';
import { BrandMark } from '@/components/marketing/MarketingChrome';
import { CloseIcon } from '@/components/ui/icons';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { APP_VERSION, AUTHOR_URL, CONTACT_EMAIL } from '@/lib/siteMeta';
import { NAV_ITEMS } from '@/routes/navItems';
import { paths } from '@/routes/paths';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

const FOOTER_LINK =
  'rounded-control text-content-muted underline decoration-border underline-offset-4 transition-colors hover:text-content';

function navLinkClass({ isActive }: { isActive: boolean }): string {
  return cn(
    'flex items-center gap-3 rounded-control px-3 py-2 text-sm font-medium transition-colors',
    isActive
      ? 'bg-primary/10 text-primary'
      : 'text-content-muted hover:bg-surface-muted hover:text-content',
  );
}

/**
 * Static rail from `lg` up, off-canvas drawer below it. The drawer is a modal
 * surface, so while it is open it traps focus and closes on Escape.
 *
 * While closed below `lg` the panel is `invisible`, not merely translated off
 * screen. A transform moves pixels but leaves the six nav links and the close
 * button in the tab order, so Tab from the topbar walked into links nobody could
 * see. `visibility: hidden` is what actually removes a subtree from the tab
 * order, and unlike `inert` it needs no polyfill and no JavaScript breakpoint
 * tracking. `lg:visible` keeps the static rail reachable on a desktop.
 */
export function Sidebar({ isOpen, onClose }: SidebarProps): JSX.Element {
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, isOpen, onClose);

  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <div
        ref={panelRef}
        id="app-navigation"
        role={isOpen ? 'dialog' : undefined}
        aria-modal={isOpen ? true : undefined}
        aria-label="Main navigation"
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-64 max-w-[85vw] flex-col border-r border-border bg-surface',
          'transition-transform duration-panel lg:visible lg:translate-x-0',
          isOpen ? 'visible translate-x-0' : 'invisible -translate-x-full',
        )}
      >
        {/*
          The lockup opens the navigation block rather than closing off a header
          band. It used to sit in an `h-16` strip with a bottom border that met the
          topbar's at the same line, so from `lg` up the two read as one bar with
          the wordmark at its left end. Without the border the strip is simply the
          top of the rail, and `h-16` keeps the lockup level with the topbar's
          controls.

          The row's `px-3` and the link's `px-3 py-2` are the nav's own `p-3` and
          `navLinkClass` box, so the mark starts on the nav icons' 24px line, the
          link's 36px box and focus ring match a nav item's, and the close button
          lines up with the nav links' right edge.

          It points at the dashboard, not the landing page the auth pages' lockup
          targets: `/` redirects a signed-in visitor there anyway, so this skips the
          hop. `onClose` for the same reason the nav links carry it: from the
          dashboard the pathname does not change, so the route effect would leave
          the drawer open.
        */}
        <div className="flex h-16 items-center justify-between gap-2 px-3">
          <Link
            to={paths.dashboard}
            onClick={onClose}
            className="group flex items-center gap-2.5 whitespace-nowrap rounded-control px-3 py-2 text-sm font-semibold tracking-tight text-content transition-colors hover:text-content-muted"
          >
            <BrandMark className="h-4 w-4 shrink-0 text-primary transition-colors group-hover:text-content-muted" />
            <span className="stretch-wide">Internship Tracker</span>
          </Link>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close navigation"
            className="rounded-control p-1.5 text-content-subtle transition-colors hover:bg-surface-muted hover:text-content lg:hidden"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>

        {/*
          Closing on click as well as on a route change matters for the one case
          the route change misses: tapping the entry for the page you are already
          on leaves the pathname untouched, so the drawer stayed open over the
          content on a phone. Found in a real browser during the phase 9 pass.
        */}
        <nav aria-label="Sections" className="flex-1 space-y-1 overflow-y-auto p-3">
          {NAV_ITEMS.map(({ label, to, icon: ItemIcon, end }) => (
            <NavLink key={to} to={to} end={end} onClick={onClose} className={navLinkClass}>
              <ItemIcon className="h-5 w-5 shrink-0" />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* `px-6` puts the text on the nav labels' left line: the nav's `p-3` plus a link's `px-3`. */}
        <p className="px-6 py-4 text-xs text-content-subtle">
          Built by{' '}
          <a href={AUTHOR_URL} target="_blank" rel="noreferrer noopener" className={FOOTER_LINK}>
            Naabel
          </a>{' '}
          <span aria-hidden="true">·</span>{' '}
          <a href={`mailto:${CONTACT_EMAIL}`} className={FOOTER_LINK}>
            Send feedback
          </a>
          <span className="mt-1 block">v{APP_VERSION}</span>
        </p>
      </div>
    </>
  );
}
