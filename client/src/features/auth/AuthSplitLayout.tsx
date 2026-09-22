import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ThemeToggle } from '@/components/ThemeToggle';
import { BrandMark } from '@/components/marketing/MarketingChrome';
import { paths } from '@/routes/paths';

interface AuthSplitLayoutProps {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer: ReactNode;
}

const HIGHLIGHTS = [
  'Every application in one board, from saved to offer.',
  'Deadline and interview reminders in your own timezone.',
  'Charts that show where your applications actually stall.',
];

/**
 * The lockup as the one route back to the landing page from here: the other
 * links on these pages only point at each other. One `Link` wraps both halves
 * so the mark and the wordmark are a single target, and the hover swaps the
 * text token on both rather than dimming the element, per the note on
 * `danger-hover` in tailwind.config.ts. The mark is `aria-hidden`, so the
 * wordmark alone names the link, the same name the marketing header's logo
 * carries.
 *
 * Rendered twice below, because the aside that carries it on wide screens is
 * hidden under `lg`. `className` is how the second copy hides itself above it.
 */
function BrandLink({ className = '' }: { className?: string }): JSX.Element {
  return (
    <Link
      to={paths.landing}
      className={`group flex w-fit items-center gap-2.5 rounded-control text-sm font-semibold tracking-tight text-content transition-colors hover:text-content-muted ${className}`}
    >
      <BrandMark className="h-4 w-4 shrink-0 text-primary transition-colors group-hover:text-content-muted" />
      <span className="stretch-wide">Internship Tracker</span>
    </Link>
  );
}

/**
 * SPEC section 6: split screen. The marketing half is hidden below `lg` so the
 * form gets the whole viewport at 375 px instead of being pushed below the fold.
 */
export function AuthSplitLayout({
  title,
  subtitle,
  children,
  footer,
}: AuthSplitLayoutProps): JSX.Element {
  return (
    <div className="grid min-h-screen bg-wash lg:grid-cols-2">
      <aside className="hidden flex-col justify-between bg-surface p-10 lg:flex">
        <BrandLink />

        <div className="space-y-6">
          <p className="max-w-[16ch] text-display-md stretch-wide text-content">
            Stop guessing where your applications stand.
          </p>
          {/* Ruled rather than bulleted, to match the ledger language the rest
              of the redesign uses. */}
          <ul className="max-w-sm divide-y divide-border border-t border-border">
            {HIGHLIGHTS.map((highlight) => (
              <li
                key={highlight}
                className="py-3 text-sm leading-relaxed text-content-muted nums-proportional"
              >
                {highlight}
              </li>
            ))}
          </ul>
        </div>

        <p className="text-xs text-content-subtle">Your data stays in your own account.</p>
      </aside>

      <main className="flex flex-col px-4 py-8 sm:px-8">
        {/*
          Under `lg` this bar is the only chrome the page has, so the lockup
          sits here opposite the toggle. Above it the aside carries the lockup
          and this copy is `display: none`, which would leave `justify-between`
          pushing the toggle to the left: hence `lg:justify-end`.
        */}
        <div className="flex items-center justify-between lg:justify-end">
          <BrandLink className="lg:hidden" />
          <ThemeToggle />
        </div>

        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-8">
          <h1 className="text-display-sm stretch-wide text-content">{title}</h1>
          <p className="mt-2 text-sm text-content-muted nums-proportional">{subtitle}</p>

          <div className="mt-8">{children}</div>

          <p className="mt-6 text-sm text-content-muted">{footer}</p>
        </div>
      </main>
    </div>
  );
}
