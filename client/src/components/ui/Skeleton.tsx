import { cn } from '@/lib/cn';

/**
 * SPEC section 6: async surfaces get a skeleton, never a bare full-page spinner.
 * `label` is announced to screen readers while the real content is missing.
 */
export function Skeleton({
  className,
  label,
}: {
  className?: string;
  label?: string;
}): JSX.Element {
  return (
    <div className={cn('skeleton', className)} role="status" aria-live="polite">
      <span className="sr-only">{label ?? 'Loading'}</span>
    </div>
  );
}
