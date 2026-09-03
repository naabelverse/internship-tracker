import { forwardRef, useState } from 'react';
import { TextField, type TextFieldProps } from '@/components/ui/TextField';
import { EyeIcon, EyeOffIcon } from '@/components/ui/icons';

export type PasswordFieldProps = Omit<TextFieldProps, 'type' | 'trailing'>;

/** A text field with the show/hide toggle SPEC section 6 asks for on the auth pages. */
export const PasswordField = forwardRef<HTMLInputElement, PasswordFieldProps>(
  function PasswordField(props, ref) {
    const [revealed, setRevealed] = useState(false);
    const ToggleIcon = revealed ? EyeOffIcon : EyeIcon;

    return (
      <TextField
        {...props}
        ref={ref}
        type={revealed ? 'text' : 'password'}
        trailing={
          <button
            type="button"
            onClick={() => {
              setRevealed((current) => !current);
            }}
            aria-label={revealed ? 'Hide password' : 'Show password'}
            aria-pressed={revealed}
            className="rounded-control p-2 text-content-subtle transition-colors hover:text-content"
          >
            <ToggleIcon className="h-5 w-5" />
          </button>
        }
      />
    );
  },
);
