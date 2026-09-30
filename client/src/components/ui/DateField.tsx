import { forwardRef, useCallback, useRef } from 'react';
import { TextField, type TextFieldProps } from '@/components/ui/TextField';
import { Popover } from '@/components/ui/Popover';
import { DatePickerCalendar } from '@/components/ui/DatePickerCalendar';
import { CalendarIcon } from '@/components/ui/icons';
import { assignRef } from '@/lib/assignRef';
import { cn } from '@/lib/cn';
import { DATE_INPUT_BOUNDS, dayFromInputValue, inputValueForDay } from '@/lib/dateInput';

export interface DateFieldProps extends Omit<TextFieldProps, 'type' | 'min' | 'max' | 'trailing'> {
  /** Renders a `datetime-local` input rather than a date-only one. */
  withTime?: boolean;
}

/**
 * Sets an input's value the way typing does, so `register`'s `onChange` sees
 * an ordinary input event. React remembers the last value it saw through the
 * element's own `value` setter, so the prototype's is used to make the change
 * visible to it.
 */
function writeInputValue(input: HTMLInputElement, value: string): void {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * The one way the app asks for a date. The input stays native, so typing into
 * its segments, `register` and the phone's own picker all keep working, and
 * `min`/`max` pin it to the years the API accepts. The schema still checks
 * the value, because `min` and `max` only mark the input invalid.
 *
 * The calendar is the app's: a `Popover` holding `DatePickerCalendar`. A pick
 * is written into the input as if typed, so it meets the same schema check and
 * reaches the form as the same change event. Alt+ArrowDown opens it, as it
 * opens a select. `date-control` and `date-picker-trigger` are the styling
 * hooks in index.css, which also decide where the calendar replaces the
 * browser's own and where it steps aside for it.
 */
export const DateField = forwardRef<HTMLInputElement, DateFieldProps>(function DateField(
  { withTime = false, className, label, onKeyDown, ...props },
  ref,
) {
  const bounds = withTime ? DATE_INPUT_BOUNDS.dateTime : DATE_INPUT_BOUNDS.date;
  const inputRef = useRef<HTMLInputElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const setInputRef = useCallback(
    (node: HTMLInputElement | null) => {
      inputRef.current = node;
      assignRef(ref, node);
    },
    [ref],
  );

  return (
    <TextField
      {...props}
      ref={setInputRef}
      label={label}
      type={withTime ? 'datetime-local' : 'date'}
      min={bounds.min}
      max={bounds.max}
      className={cn('date-control', className)}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.altKey && event.key === 'ArrowDown') {
          event.preventDefault();
          triggerRef.current?.click();
        }
      }}
      trailing={
        <Popover
          ref={triggerRef}
          label={label}
          role="dialog"
          anchorRef={inputRef}
          triggerLabel={`${label}, choose from calendar`}
          triggerClassName="date-picker-trigger rounded-control p-2 text-content-muted transition-colors hover:text-content"
          panelClassName="p-3"
          trigger={<CalendarIcon className="h-5 w-5" />}
        >
          {(close) => (
            <DatePickerCalendar
              selected={dayFromInputValue(inputRef.current?.value ?? '')}
              onPick={(day) => {
                const input = inputRef.current;
                if (input) writeInputValue(input, inputValueForDay(day, withTime, input.value));
                close();
              }}
            />
          )}
        </Popover>
      }
    />
  );
});
