import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ThemeToggle } from '@/components/ThemeToggle';
import { APP_TAGLINE, CONTACT_EMAIL, REPO_URL } from '@/lib/siteMeta';
import { STATUS_CONFIG } from '@/lib/statusConfig';
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
const PRIMARY_BUTTON =
  'inline-flex h-9 items-center whitespace-nowrap rounded-control bg-primary-fill px-3.5 text-sm font-semibold text-primary-fill-fg transition-colors hover:bg-primary-fill-hover';

/**
 * The mark: an angular fold.
 *
 * The path is written out here rather than imported because the one definition
 * lives in `scripts/brandMark.mjs`, which the icon generator runs from npm
 * before Vite or tsc exist to resolve it. `tests/config/brandMark.test.tsx`
 * asserts this `d` is still the one that module exports, so the copy cannot go
 * quietly stale the way the favicons' colours once did.
 *
 * `currentColor` is the entire colour mechanism: every caller sets
 * `text-primary`, so the mark resolves `--color-primary` for whichever theme is
 * mounted and no hex appears in the component at all.
 *
 * The viewBox frames the glyph's own bounds rather than the padded box the icon
 * tiles take, so at `h-4 w-4` the mark carries the same weight beside the
 * wordmark that the three bars it replaced did.
 */
export function BrandMark({ className = 'h-4 w-4' }: { className?: string }): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="96 96 320 320" className={className} fill="currentColor">
      <path d="M176 112H416V280L296 400V200H96V168Z" />
    </svg>
  );
}

export function MarketingHeader(): JSX.Element {
  return (
    <header className="border-b border-border bg-canvas">
      <nav
        aria-label="Main"
        className="marketing-shell flex h-16 items-center justify-between gap-4"
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
          <Link to={paths.register} className={PRIMARY_BUTTON}>
            Create account
          </Link>
        </div>
      </nav>
    </header>
  );
}

const PIPELINE_STAGES = ['saved', 'applied', 'interview', 'offer'] as const;

/**
 * Decoration for the sign-up card's middle: an application moving through the
 * pipeline. Only from `lg`, where the card has a gap to fill; below that the
 * card stacks and there is none. Reduced motion keeps the stages and drops the
 * comet and pings.
 */
function PipelineAnimation(): JSX.Element {
  return (
    <div aria-hidden="true" className="mx-10 hidden max-w-xs flex-1 pb-6 lg:block">
      <div className="relative flex items-center justify-between">
        <div className="absolute inset-x-[5px] top-1/2 h-px -translate-y-1/2 bg-border-strong">
          <span className="absolute top-1/2 h-0.5 w-10 -translate-x-full -translate-y-1/2 rounded-full bg-gradient-to-r from-transparent to-primary opacity-0 motion-safe:animate-pipeline-travel" />
        </div>
        {PIPELINE_STAGES.map((status, i) => {
          const { label, dot } = STATUS_CONFIG[status];
          return (
            <span key={status} className="relative h-2.5 w-2.5">
              <span
                className={`absolute inset-0 rounded-full ${dot} opacity-0 motion-safe:animate-stage-ping`}
                style={{ animationDelay: `${i}s` }}
              />
              <span className={`relative block h-full w-full rounded-full ${dot}`} />
              <span className="absolute left-1/2 top-5 -translate-x-1/2 whitespace-nowrap text-xs text-content-subtle">
                {label}
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

interface MarketingFooterProps {
  /**
   * The closing sign-up card. On for the landing page, which otherwise ends on
   * the FAQ with no last ask; off for Terms and Privacy, where someone is
   * checking the fine print and a pitch reads as pushy. The header's
   * "Create account" is on every page either way.
   */
  signUpCard?: boolean;
}

export function MarketingFooter({ signUpCard = false }: MarketingFooterProps): JSX.Element {
  return (
    <footer className="overflow-hidden border-t border-border bg-canvas">
      <div className="marketing-shell pt-14 [container-type:inline-size]">
        {signUpCard && (
          <div className="mb-12 flex flex-col gap-5 rounded-panel border border-border bg-surface p-6 shadow-card sm:flex-row sm:items-center sm:justify-between sm:p-8">
            <div>
              <h2 className="text-xl font-semibold tracking-tight text-content stretch-wide sm:text-2xl">
                Ready for your next application?
              </h2>
              <p className="mt-1.5 text-sm text-content-muted">{APP_TAGLINE}</p>
            </div>
            <PipelineAnimation />
            <Link to={paths.register} className={`${PRIMARY_BUTTON} self-start sm:self-auto`}>
              Create an account
            </Link>
          </div>
        )}

        <ul className="flex flex-wrap justify-center gap-x-6 gap-y-2">
          <li>
            <Link to={paths.login} className={LINK}>
              Sign in
            </Link>
          </li>
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
        </ul>

        <p className="mx-auto mt-4 max-w-[60ch] text-center text-xs leading-relaxed text-content-subtle nums-proportional">
          Open source, and free because it costs almost nothing to run. Export your data or delete
          it whenever you like.
        </p>

        {/*
          The wordmark as decoration: sized in container units so it spans the
          shell at every width, and pushed past the footer's bottom edge so the
          clip crops its foot. Hidden from assistive tech because the header's
          logo link already carries the name.
        */}
        <p
          aria-hidden="true"
          className="mt-8 select-none whitespace-nowrap text-center text-[length:9.7cqw] font-extrabold leading-[0.78] tracking-tight text-wordmark stretch-display translate-y-[0.12em]"
        >
          Internship Tracker
        </p>
      </div>
    </footer>
  );
}

/** The shell every logged-out page renders into. */
export function MarketingShell({
  children,
  signUpCard,
}: { children: ReactNode } & MarketingFooterProps): JSX.Element {
  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <MarketingHeader />
      <main id="main" className="flex-1">
        {children}
      </main>
      <MarketingFooter signUpCard={signUpCard} />
    </div>
  );
}
