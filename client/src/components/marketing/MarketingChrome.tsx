import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ThemeToggle } from '@/components/ThemeToggle';
import { APP_TAGLINE, CONTACT_EMAIL, REPO_URL } from '@/lib/siteMeta';
import { paths } from '@/routes/paths';

/**
 * Header and footer for the logged-out pages.
 *
 * Deliberately not `AppLayout`: that shell has a sidebar, a topbar and a
 * notification bell, all of which need a session. A marketing page has no
 * session by definition, so it gets its own chrome rather than a version of the
 * app's with half the pieces switched off.
 */

const LINK = 'rounded-control text-sm text-content-muted transition-colors hover:text-content';

/**
 * The mark: three bars narrowing top to bottom.
 *
 * It is the funnel the product is about — applications, then interviews, then
 * offers — rather than an arbitrary glyph or the app's initials in a box.
 */
export function BrandMark({ className = 'h-4 w-4' }: { className?: string }): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className={className} fill="currentColor">
      <rect x="1" y="2" width="14" height="2.6" rx="0.7" opacity="0.35" />
      <rect x="1" y="6.7" width="9" height="2.6" rx="0.7" opacity="0.7" />
      <rect x="1" y="11.4" width="5" height="2.6" rx="0.7" />
    </svg>
  );
}

export function MarketingHeader(): JSX.Element {
  return (
    <header className="border-b border-border bg-canvas">
      <nav
        aria-label="Main"
        className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6"
      >
        <Link
          to={paths.landing}
          aria-label="Internship Tracker"
          className="flex shrink-0 items-center gap-2.5 rounded-control text-sm font-semibold tracking-tight text-content"
        >
          <BrandMark className="h-4 w-4 shrink-0 text-primary" />
          {/*
            The wordmark set in the wide face pushes the header onto two lines at
            375px. Below `sm` the mark carries the identity alone; the aria-label
            keeps the link's accessible name identical at every width.
          */}
          <span className="hidden whitespace-nowrap stretch-wide sm:inline">
            Internship Tracker
          </span>
        </Link>

        {/*
          The same `ThemeToggle` the app shell and the auth pages render, so the
          logged-out surface drives the one theme store rather than a second
          mechanism: it writes the same storage key the inline boot script in
          index.html reads, which is what keeps the no-flash behaviour intact
          here. Signed out there is no account to sync to, and the component
          already handles that case.
        */}
        <div className="flex items-center gap-1 sm:gap-2">
          <ThemeToggle />
          <Link to={paths.login} className={`${LINK} whitespace-nowrap px-2 py-2 sm:px-3`}>
            Sign in
          </Link>
          <Link
            to={paths.register}
            className="inline-flex h-9 items-center whitespace-nowrap rounded-control bg-primary px-3.5 text-sm font-semibold text-primary-fg transition-colors hover:bg-primary-hover"
          >
            Create account
          </Link>
        </div>
      </nav>
    </header>
  );
}

interface FooterColumnProps {
  title: string;
  children: ReactNode;
}

function FooterColumn({ title, children }: FooterColumnProps): JSX.Element {
  return (
    <div>
      <h2 className="text-xs font-semibold text-content-subtle">{title}</h2>
      <ul className="mt-3 space-y-2">{children}</ul>
    </div>
  );
}

export function MarketingFooter(): JSX.Element {
  return (
    <footer className="border-t border-border bg-canvas">
      <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        {/*
          Asymmetric on purpose: the wordmark block is the widest thing here and
          the three link groups cluster to the right of it, rather than four
          columns of equal weight pretending the sitemap is the point.
        */}
        <div className="grid gap-10 lg:grid-cols-12 lg:gap-8">
          <div className="lg:col-span-5">
            <p className="flex items-center gap-2.5 text-sm font-semibold tracking-tight text-content">
              <BrandMark className="h-4 w-4 text-primary" />
              <span className="stretch-wide">Internship Tracker</span>
            </p>
            <p className="mt-3 max-w-[38ch] text-sm leading-relaxed text-content-muted nums-proportional">
              {APP_TAGLINE}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-8 sm:grid-cols-3 lg:col-span-7">
            <FooterColumn title="Product">
              <li>
                <Link to={paths.register} className={LINK}>
                  Create an account
                </Link>
              </li>
              <li>
                <Link to={paths.login} className={LINK}>
                  Sign in
                </Link>
              </li>
            </FooterColumn>

            <FooterColumn title="Legal">
              <li>
                <Link to={paths.terms} className={LINK}>
                  Terms of Service
                </Link>
              </li>
              <li>
                <Link to={paths.privacy} className={LINK}>
                  Privacy Policy
                </Link>
              </li>
            </FooterColumn>

            <FooterColumn title="Project">
              <li>
                <a href={REPO_URL} className={LINK} rel="noreferrer noopener" target="_blank">
                  GitHub
                </a>
              </li>
              <li>
                <a href={`mailto:${CONTACT_EMAIL}`} className={LINK}>
                  Contact
                </a>
              </li>
            </FooterColumn>
          </div>
        </div>

        <p className="mt-12 border-t border-border pt-6 text-xs leading-relaxed text-content-subtle nums-proportional">
          Open source, and free because it costs almost nothing to run. Export your data or delete
          it whenever you like.
        </p>
      </div>
    </footer>
  );
}

/** The shell every logged-out page renders into. */
export function MarketingShell({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <MarketingHeader />
      <main id="main" className="flex-1">
        {children}
      </main>
      <MarketingFooter />
    </div>
  );
}
