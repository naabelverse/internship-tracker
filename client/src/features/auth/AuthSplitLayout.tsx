import type { ReactNode } from 'react';
import { ThemeToggle } from '@/components/ThemeToggle';
import { BrandMark } from '@/components/marketing/MarketingChrome';

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
        <span className="flex items-center gap-2.5 text-sm font-semibold tracking-tight text-content">
          <BrandMark className="h-4 w-4 text-primary" />
          <span className="stretch-wide">Internship Tracker</span>
        </span>

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
        <div className="flex justify-end">
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
