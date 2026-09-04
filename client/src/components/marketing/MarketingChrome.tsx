import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
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

export function MarketingHeader(): JSX.Element {
  return (
    <header className="border-b border-border bg-surface">
      <nav
        aria-label="Main"
        className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6"
      >
        <Link
          to={paths.landing}
          className="flex items-center gap-2 rounded-control text-sm font-semibold tracking-tight text-content"
        >
          <span
            aria-hidden="true"
            className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-xs font-bold text-primary-fg"
          >
            IT
          </span>
          Internship Tracker
        </Link>

        <div className="flex items-center gap-1 sm:gap-3">
          <Link to={paths.login} className={`${LINK} px-3 py-2`}>
            Sign in
          </Link>
          <Link
            to={paths.register}
            className="inline-flex h-9 items-center rounded-control bg-primary px-3 text-sm font-medium text-primary-fg transition-colors hover:bg-primary-hover"
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
      <h2 className="text-xs font-semibold uppercase tracking-widest text-content-subtle">
        {title}
      </h2>
      <ul className="mt-3 space-y-2">{children}</ul>
    </div>
  );
}

export function MarketingFooter(): JSX.Element {
  return (
    <footer className="border-t border-border bg-surface">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="text-sm font-semibold text-content">Internship Tracker</p>
            <p className="mt-2 max-w-xs text-sm text-content-muted">{APP_TAGLINE}</p>
          </div>

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

        <p className="mt-10 border-t border-border pt-6 text-xs text-content-subtle">
          Built as an open-source project. Your data is yours — export it or delete it whenever you
          like.
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
