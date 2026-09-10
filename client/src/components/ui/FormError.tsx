/**
 * The form-level error, defined once.
 *
 * Four forms rendered `errors.root` through an identical `role="alert"` element
 * carrying an identical seven-utility string. Each also wrote its own
 * `{errors.root && (...)}` guard, so the guard and the markup drifted as a pair.
 *
 * Taking the message rather than the react-hook-form error object keeps this
 * usable by anything with a string to report, and rendering `null` on an absent
 * message moves the guard in here — the call site passes the message and stops
 * deciding whether there is one.
 */
interface FormErrorProps {
  /** The message. `undefined` renders nothing, which collapses the call guard. */
  message?: string;
}

/** A form-level error message, announced to assistive technology. */
export function FormError({ message }: FormErrorProps): JSX.Element | null {
  if (message === undefined || message === '') return null;

  return (
    <p
      role="alert"
      className="rounded-control border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger"
    >
      {message}
    </p>
  );
}
