import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  hint?: string;
  /** Rendered inside the field at its start, used by the toolbar search for its icon. */
  leading?: ReactNode;
  /** Rendered inside the field, used by `PasswordField` for its reveal toggle. */
  trailing?: ReactNode;
  /** Hides the visible label but keeps it for assistive technology. */
  labelHidden?: boolean;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, error, hint, leading, trailing, labelHidden = false, className, id, ...props },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const errorId = `${inputId}-error`;
  const hintId = `${inputId}-hint`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ');

  const labelElement = (
    <label
      htmlFor={inputId}
      className={cn('block text-sm font-medium text-content', labelHidden && 'sr-only')}
    >
      {label}
    </label>
  );

  return (
    <div className="space-y-1.5">
      {/*
        A hidden label goes inside the field's box rather than above it.
        `space-y-1.5` gives every child after the first a 6px top margin, and a
        visually hidden label still counts as the first, so the input was pushed
        down with nothing visible above it.
      */}
      {!labelHidden && labelElement}

      <div className="relative">
        {labelHidden && labelElement}
        <input
          {...props}
          id={inputId}
          ref={ref}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy || undefined}
          className={cn(
            'h-11 w-full rounded-control border bg-surface px-3 text-sm text-content',
            'placeholder:text-content-subtle',
            leading ? 'pl-9' : undefined,
            trailing ? 'pr-11' : undefined,
            error ? 'border-danger' : 'border-border',
            className,
          )}
        />
        {/* After the input, so it paints above the input's opaque background. */}
        {leading && (
          <div className="pointer-events-none absolute inset-y-0 left-3 flex items-center">
            {leading}
          </div>
        )}
        {trailing && <div className="absolute inset-y-0 right-1 flex items-center">{trailing}</div>}
      </div>

      {hint && !error && (
        <p id={hintId} className="text-xs text-content-subtle">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
});
