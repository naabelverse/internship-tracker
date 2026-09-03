import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { getApiErrorCode, getErrorMessage, getFieldErrors } from '@/api/errors';

/** Server messages are sentence fragments ("must be at least 8 characters"). */
function asSentence(message: string): string {
  return message.charAt(0).toUpperCase() + message.slice(1);
}

/**
 * Maps an API failure onto the form: per-field where the server said which field
 * was wrong, and onto `root` otherwise, so a 401 or an unreachable server still
 * produces a message the user can read instead of only a toast.
 */
export function applyServerErrors<TValues extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<TValues>,
  fields: readonly Path<TValues>[],
  fallback: string,
): void {
  const fieldErrors = getFieldErrors(error);
  let matched = false;

  for (const field of fields) {
    const message = fieldErrors[field]?.[0];
    if (message !== undefined) {
      setError(field, { type: 'server', message: asSentence(message) });
      matched = true;
    }
  }

  // A duplicate email is a 409 with a code rather than a field map, but it is
  // still a fact about the email input and belongs next to it.
  const code = getApiErrorCode(error);
  const emailField = 'email' as Path<TValues>;
  if (
    !matched &&
    (code === 'EMAIL_IN_USE' || code === 'DUPLICATE_KEY') &&
    fields.includes(emailField)
  ) {
    setError(emailField, { type: 'server', message: 'An account with that email already exists' });
    matched = true;
  }

  if (!matched) {
    setError('root', { type: 'server', message: getErrorMessage(error, fallback) });
  }
}
