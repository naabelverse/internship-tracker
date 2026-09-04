import { useState, type KeyboardEvent } from 'react';
import { Button } from '@/components/ui/Button';
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
 * Enter and the Add button both commit, and Backspace on an empty input removes
 * the last chip, so the control is fully operable without a pointer. Each chip
 * keeps its own remove button with a label naming the role it removes, rather
 * than a row of identical "Remove" buttons a screen reader cannot tell apart.
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
      return;
    }

    if (event.key === 'Backspace' && draft === '' && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <TextField
            label="Target roles"
            hint="Press Enter to add. These shape the roles suggested to you."
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
            }}
            onKeyDown={onKeyDown}
            error={error}
            placeholder="Frontend Intern"
            maxLength={80}
          />
        </div>
        <Button variant="secondary" onClick={commit} disabled={draft.trim() === ''}>
          Add
        </Button>
      </div>

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
                className="rounded p-0.5 text-content-subtle transition-colors hover:bg-border hover:text-content"
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
