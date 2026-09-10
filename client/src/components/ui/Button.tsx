import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-primary-fill text-primary-fill-fg hover:bg-primary-fill-hover',
  secondary: 'bg-surface text-content border border-border hover:bg-surface-muted',
  ghost: 'text-content-muted hover:bg-surface-muted hover:text-content',
  danger: 'bg-danger text-danger-fg hover:bg-danger-hover',
};

const SIZES: Record<Size, string> = {
  sm: 'h-9 px-3 text-sm',
  md: 'h-11 px-4 text-sm',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /** Disables the button and swaps the label for a spinner plus `loadingLabel`. */
  isLoading?: boolean;
  loadingLabel?: string;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    isLoading = false,
    loadingLabel = 'Working',
    className,
    children,
    disabled,
    type = 'button',
    ...props
  },
  ref,
) {
  return (
    <button
      {...props}
      ref={ref}
      type={type}
      disabled={disabled === true || isLoading}
      aria-busy={isLoading}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-control font-medium transition-colors',
        /*
          0.5 rather than 0.6, which puts it in the 0.38-0.5 band the
          guidelines specify for a disabled control. Worth stating that this
          *lowers* measured contrast rather than raising it: opacity composites
          the label and the fill toward the page behind, so the label goes from
          about 3.3:1 to about 2.7:1. That is allowed rather than overlooked —
          WCAG 2.2 exempts inactive components from contrast entirely (SC
          1.4.3), because the requirement being served here is affordance, not
          legibility: a disabled control has to read as unmistakably not
          clickable. 0.5 is the top of the band, so it is the smallest
          reduction that satisfies it, and `cursor-not-allowed` carries the
          same message a second way.
        */
        'disabled:cursor-not-allowed disabled:opacity-50',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
    >
      {isLoading && (
        <span
          className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
          aria-hidden="true"
        />
      )}
      {isLoading ? loadingLabel : children}
    </button>
  );
});
