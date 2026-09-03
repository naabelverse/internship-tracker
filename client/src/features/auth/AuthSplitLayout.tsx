import type { ReactNode } from 'react';
import { ThemeToggle } from '@/components/ThemeToggle';

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
    <div className="grid min-h-screen bg-canvas lg:grid-cols-2">
      <aside className="hidden flex-col justify-between bg-surface p-10 lg:flex">
        <span className="text-sm font-semibold tracking-tight text-content">
          Internship Tracker
        </span>

        <div className="space-y-6">
          <p className="max-w-sm text-2xl font-semibold leading-snug tracking-tight text-content">
            Stop guessing where your applications stand.
          </p>
          <ul className="space-y-3">
            {HIGHLIGHTS.map((highlight) => (
              <li key={highlight} className="flex gap-3 text-sm text-content-muted">
                <span
                  aria-hidden="true"
                  className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
                />
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
          <h1 className="text-2xl font-semibold tracking-tight text-content">{title}</h1>
          <p className="mt-1.5 text-sm text-content-muted">{subtitle}</p>

          <div className="mt-8">{children}</div>

          <p className="mt-6 text-sm text-content-muted">{footer}</p>
        </div>
      </main>
    </div>
  );
}
