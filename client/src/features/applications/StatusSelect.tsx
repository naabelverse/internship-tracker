import { APPLICATION_STATUSES, type ApplicationStatus } from '@/types/application';
import { STATUS_CONFIG } from '@/lib/statusConfig';
import { cn } from '@/lib/cn';

interface StatusSelectProps {
  value: ApplicationStatus;
  onChange: (status: ApplicationStatus) => void;
  disabled?: boolean;
  /** Announced to screen readers, since the control shows only the status word. */
  label: string;
}

/**
 * The inline status control from SPEC section 6. It is a native `select` on
 * purpose: it is keyboard and screen-reader correct for free, and it works with
 * the platform picker on a phone where a custom listbox would not.
 */
export function StatusSelect({
  value,
  onChange,
  disabled = false,
  label,
}: StatusSelectProps): JSX.Element {
  return (
    <select
      value={value}
      disabled={disabled}
      aria-label={label}
      onChange={(event) => {
        onChange(event.target.value as ApplicationStatus);
      }}
      onClick={(event) => {
        // Rows are links; without this the picker would also navigate.
        event.stopPropagation();
      }}
      className={cn(
        'select-control rounded-full border-0 px-2.5 py-1 text-xs font-medium',
        'disabled:cursor-progress disabled:opacity-70',
        STATUS_CONFIG[value].pill,
      )}
    >
      {APPLICATION_STATUSES.map((status) => (
        <option key={status} value={status}>
          {STATUS_CONFIG[status].label}
        </option>
      ))}
    </select>
  );
}
