import { forwardRef, useId, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  error?: string;
  hint?: string;
  labelHidden?: boolean;
}

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  { label, error, hint, labelHidden = false, className, id, ...props },
  ref,
) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const errorId = `${fieldId}-error`;
  const hintId = `${fieldId}-hint`;

  return (
    <div className="space-y-1.5">
      <label
        htmlFor={fieldId}
        className={cn('block text-sm font-medium text-content', labelHidden && 'sr-only')}
      >
        {label}
      </label>

      <textarea
        {...props}
        id={fieldId}
        ref={ref}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : hint ? hintId : undefined}
        className={cn(
          'w-full rounded-control border bg-surface px-3 py-2 text-sm text-content',
          'placeholder:text-content-subtle',
          error ? 'border-danger' : 'border-border',
          className,
        )}
      />

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
