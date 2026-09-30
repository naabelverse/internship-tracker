import { forwardRef } from 'react';
import { TextField, type TextFieldProps } from '@/components/ui/TextField';
import { cn } from '@/lib/cn';
import { DATE_INPUT_BOUNDS } from '@/lib/dateInput';

export interface DateFieldProps extends Omit<TextFieldProps, 'type' | 'min' | 'max'> {
  /** Renders a `datetime-local` input rather than a date-only one. */
  withTime?: boolean;
}

/**
 * The one way the app asks for a date. It stays a native input, so the keyboard
 * model and the phone's own picker come for free, and pins `min` and `max` to
 * the years the API accepts, which the browser's calendar honours. The form
 * schema still checks the value, because `min` and `max` only mark the input
 * invalid: `value` goes on reporting whatever was typed. `date-control` is the
 * styling hook in index.css.
 */
export const DateField = forwardRef<HTMLInputElement, DateFieldProps>(function DateField(
  { withTime = false, className, ...props },
  ref,
) {
  const bounds = withTime ? DATE_INPUT_BOUNDS.dateTime : DATE_INPUT_BOUNDS.date;

  return (
    <TextField
      {...props}
      ref={ref}
      type={withTime ? 'datetime-local' : 'date'}
      min={bounds.min}
      max={bounds.max}
      className={cn('date-control', className)}
    />
  );
});
