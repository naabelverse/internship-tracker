import { DayPicker, type ChevronProps } from 'react-day-picker';
import { ChevronLeftIcon, ChevronRightIcon } from '@/components/ui/icons';
import { CALENDAR_BOUNDS } from '@/lib/dateInput';

interface DatePickerCalendarProps {
  /** The field's current day, or `undefined` when it is empty or out of range. */
  selected: Date | undefined;
  onPick: (day: Date) => void;
}

/** The month arrows, drawn with the app's own chevrons rather than the library's. */
function Chevron({ orientation, className }: ChevronProps): JSX.Element {
  const Icon = orientation === 'left' ? ChevronLeftIcon : ChevronRightIcon;
  return <Icon className={className} />;
}

/**
 * The month grid `DateField` opens. `react-day-picker` supplies the grid
 * semantics and the keyboard model (arrows, Home/End, PageUp/PageDown, Enter);
 * this pins it to the years the API accepts, to Monday-first weeks like the
 * Calendar page, and to a fixed six rows so the panel never changes height
 * while it floats. Every visual rule is `.date-calendar` in index.css.
 */
export function DatePickerCalendar({ selected, onPick }: DatePickerCalendarProps): JSX.Element {
  return (
    <DayPicker
      mode="single"
      required
      selected={selected}
      onSelect={(day) => {
        onPick(day);
      }}
      defaultMonth={selected}
      startMonth={CALENDAR_BOUNDS.first}
      endMonth={CALENDAR_BOUNDS.last}
      disabled={[{ before: CALENDAR_BOUNDS.first }, { after: CALENDAR_BOUNDS.last }]}
      weekStartsOn={1}
      showOutsideDays
      fixedWeeks
      autoFocus
      className="date-calendar"
      components={{ Chevron }}
    />
  );
}
