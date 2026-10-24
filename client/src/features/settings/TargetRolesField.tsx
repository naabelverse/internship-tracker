import { useState, type KeyboardEvent } from 'react';
import { CloseIcon } from '@/components/ui/icons';
import { TextField } from '@/components/ui/TextField';

interface TargetRolesFieldProps {
  value: string[];
  onChange: (value: string[]) => void;
  error?: string;
}

const MAX_ROLES = 20;

/**
 * A chip input for `targetRoles`.
 *
 * Enter and the Add button both commit. Chips are removed only through their
 * own buttons: Backspace on an empty input used to remove the last one, so
 * clearing a draft with a held Backspace silently ate saved roles too. Each
 * remove button's label names its role, rather than a row of identical
 * "Remove" buttons a screen reader cannot tell apart.
 */
export function TargetRolesField({ value, onChange, error }: TargetRolesFieldProps): JSX.Element {
  const [draft, setDraft] = useState('');

  const commit = (): void => {
    const role = draft.trim();
    if (role === '' || value.length >= MAX_ROLES) return;
    if (value.some((existing) => existing.toLowerCase() === role.toLowerCase())) {
      setDraft('');
      return;
    }

    onChange([...value, role]);
    setDraft('');
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      // Otherwise Enter submits the surrounding form instead of adding a role.
      event.preventDefault();
      commit();
    }
  };

  return (
    <div className="space-y-2">
      <TextField
        label="Target roles"
        hint="Press Enter to add. These shape the roles suggested to you."
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
        }}
        onKeyDown={onKeyDown}
        error={error}
        placeholder="e.g. Frontend Intern"
        maxLength={80}
        // Inside the field, like the search's clear button. Beside it, the
        // button lined up with the hint line instead of the input.
        trailing={
          draft.trim() !== '' && (
            <button
              type="button"
              onClick={commit}
              className="rounded-control px-2 py-1.5 text-xs font-medium text-content-muted transition-colors hover:bg-surface-muted hover:text-content"
            >
              Add
            </button>
          )
        }
      />

      {value.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {value.map((role) => (
            <li
              key={role}
              className="inline-flex items-center gap-1 rounded-control bg-surface-muted py-1 pl-2.5 pr-1 text-xs text-content"
            >
              {role}
              <button
                type="button"
                aria-label={`Remove ${role}`}
                onClick={() => {
                  onChange(value.filter((existing) => existing !== role));
                }}
                className="rounded-chip p-0.5 text-content-subtle transition-colors hover:bg-border hover:text-content"
              >
                <CloseIcon className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
