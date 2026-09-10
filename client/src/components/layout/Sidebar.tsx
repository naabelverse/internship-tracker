import { useRef } from 'react';
import { NavLink } from 'react-router-dom';
import { cn } from '@/lib/cn';
import { CloseIcon } from '@/components/ui/icons';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { NAV_ITEMS } from '@/routes/navItems';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

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
        <div className="flex h-16 items-center justify-between gap-2 border-b border-border px-4">
          <span className="text-sm font-semibold tracking-tight text-content">
            Internship Tracker
          </span>
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
      </div>
    </>
  );
}
