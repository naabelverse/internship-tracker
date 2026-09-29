import { forwardRef, useId, type SelectHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  options: readonly SelectOption[];
  error?: string;
  /** Adds a blank first option for a field the user may leave unset. */
  placeholder?: string;
  /** Hides the visible label but keeps it for assistive technology. */
  labelHidden?: boolean;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, options, error, placeholder, labelHidden = false, className, id, ...props },
  ref,
) {
  const generatedId = useId();
  const selectId = id ?? generatedId;
  const errorId = `${selectId}-error`;

  return (
    <div className="space-y-1.5">
      <label
        htmlFor={selectId}
        className={cn('block text-sm font-medium text-content', labelHidden && 'sr-only')}
      >
        {label}
      </label>

      <select
        {...props}
        id={selectId}
        ref={ref}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className={cn(
          'select-control h-11 w-full rounded-control border bg-surface px-3 text-sm text-content',
          error ? 'border-danger' : 'border-border',
          className,
        )}
      >
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      {error && (
        <p id={errorId} role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
});
