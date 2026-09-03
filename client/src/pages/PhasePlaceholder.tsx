interface PhasePlaceholderProps {
  /** The build phase in SPEC section 16 that replaces this page's body. */
  phase: number;
  title: string;
  description: string;
}

/**
 * The visible body of a route whose feature is scheduled for a later phase.
 *
 * The route, its path, its guard and its test all exist and are real; only the
 * content is outstanding. A later phase replaces the body of the page module that
 * renders this and nothing else moves.
 */
export function PhasePlaceholder({
  phase,
  title,
  description,
}: PhasePlaceholderProps): JSX.Element {
  return (
    <section data-testid="phase-placeholder" data-phase={phase} className="space-y-3">
      <h1 className="text-2xl font-semibold tracking-tight text-content">{title}</h1>
      <p className="max-w-prose text-sm text-content-muted">{description}</p>
      <p className="inline-flex rounded-control border border-border bg-surface-muted px-3 py-1.5 text-xs font-medium text-content-subtle">
        Arrives in phase {phase}
      </p>
    </section>
  );
}
