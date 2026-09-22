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
 *
 * The `after:` band is the link's hit area, not decoration. The lockup paints
 * 146x20 — `text-sm`'s 20px line box over a 16px mark — and 20px is half the
 * 40px a pointer or a thumb wants. Padding is the obvious fix and the wrong one
 * here: it would grow the link's own border box, which is what the aside's
 * `justify-between` column distributes around, what the phone bar's
 * `items-center` row measures its height from, and what the global
 * `:focus-visible` ring in index.css draws around. An absolutely positioned
 * pseudo-element is outside flow, so it is not a flex item, takes part in no
 * measurement, and leaves the ring on the 20px box — it only answers
 * `elementFromPoint`. `inset-x-0` keeps it exactly as wide as the lockup, so it
 * cannot reach across the phone bar toward the theme toggle at the other end.
 */
function BrandLink({ className = '' }: { className?: string }): JSX.Element {
  return (
    <Link
      to={paths.landing}
      className={`group relative flex w-fit items-center gap-2.5 rounded-control text-sm font-semibold tracking-tight text-content transition-colors after:absolute after:inset-x-0 after:top-1/2 after:h-10 after:-translate-y-1/2 after:content-[''] hover:text-content-muted ${className}`}
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
      {/*
        The horizontal inset is a step above the vertical one. This panel holds a
        411px heading over a 384px list inside a half-viewport column, so at `p-10`
        its copy started 40px from the viewport edge while the form column's centred
        block starts 64px from its own edge at `lg` and 168px at 1440 — the left half
        read as jammed against the edge. `px-16` matches that 64px exactly where the
        split first appears and `xl:px-24` keeps the inset growing with the panel.
        `py-10` is deliberately unchanged, so the rhythm `justify-between` distributes
        between the lockup, the copy and the footer is the same as before.
      */}
      <aside className="hidden flex-col justify-between bg-surface px-16 py-10 lg:flex xl:px-24">
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
