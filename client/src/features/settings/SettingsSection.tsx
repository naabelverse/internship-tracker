import type { ReactNode } from 'react';

interface SettingsSectionProps {
  title: string;
  description: string;
  /** Rendered in the footer bar, normally the save button. */
  footer?: ReactNode;
  /** Wraps the section in a form when the caller submits one. */
  onSubmit?: (event: React.FormEvent<HTMLFormElement>) => void;
  children: ReactNode;
}

/**
 * The card every settings group sits in.
 *
 * The heading is a real `h2` inside a `section` labelled by it, so the page has
 * a navigable outline rather than five visually distinct but structurally
 * identical blocks.
 */
export function SettingsSection({
  title,
  description,
  footer,
  onSubmit,
  children,
}: SettingsSectionProps): JSX.Element {
  const body = (
    <>
      <div className="border-b border-border px-4 py-4 sm:px-5">
        <h2 className="text-sm font-semibold stretch-wide text-content">{title}</h2>
        <p className="mt-0.5 text-sm text-content-muted">{description}</p>
      </div>

      <div className="space-y-4 px-4 py-4 sm:px-5">{children}</div>

      {footer && (
        <div className="flex flex-wrap justify-end gap-2 border-t border-border px-4 py-3 sm:px-5">
          {footer}
        </div>
      )}
    </>
  );

  const className = 'overflow-hidden rounded-card border border-border bg-surface';

  return onSubmit ? (
    <form noValidate onSubmit={onSubmit} className={className} aria-labelledby={undefined}>
      <section aria-label={title}>{body}</section>
    </form>
  ) : (
    <section aria-label={title} className={className}>
      {body}
    </section>
  );
}
