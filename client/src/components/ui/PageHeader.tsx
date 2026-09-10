import type { ReactNode } from 'react';

/**
 * The page header, defined once.
 *
 * Five pages assembled this by hand and disagreed in two ways. The lede carried
 * `mt-0.5` on Dashboard and Settings and no top margin at all on Applications,
 * Board and Calendar — the same role at two spacings, decided by whichever page
 * was opened last. Applications also carried the `flex flex-wrap items-center
 * justify-between gap-3` wrapper around a single child, copied from a page that
 * has an action button, where `justify-between` has nothing to distribute.
 *
 * `mt-0.5` is the resolved value. `display-sm` sets a tight 1.18 line height, so
 * the lede needs the small optical gap; the two pages that had it were the two
 * most recently worked on. See DECISIONS.md.
 *
 * The flex row is applied only when there is something to put on the other end
 * of it, so the wrapper describes the layout rather than being inherited.
 */
interface PageHeaderProps {
  title: string;
  /** The line under the title. Omitted on pages that have nothing to add. */
  description?: ReactNode;
  /** Trailing controls — a primary action. Turns the header into a flex row. */
  actions?: ReactNode;
}

/** The `<h1>` of a routed page, with its optional lede and trailing actions. */
export function PageHeader({ title, description, actions }: PageHeaderProps): JSX.Element {
  return (
    <header className={actions ? 'flex flex-wrap items-center justify-between gap-3' : undefined}>
      <div>
        <h1 className="text-display-sm stretch-wide text-content">{title}</h1>
        {description !== undefined && (
          <p className="mt-0.5 text-sm text-content-muted">{description}</p>
        )}
      </div>
      {actions}
    </header>
  );
}
