/**
 * Per-account resource ceilings, fixed by SPEC section 12.
 *
 * These are constants rather than environment variables on purpose: they are a
 * product decision about what one free account may consume, not a knob to turn
 * per deployment. A deployment that wants different numbers is forking the
 * policy, and should do it here where the reasoning lives.
 *
 * Every one of them is enforced in `usage.service`, on the server, because a
 * limit the client checks is not a limit.
 */

/** Applications one account may hold. */
export const MAX_APPLICATIONS_PER_ACCOUNT = 2_000;

/** Total bytes of attachments one account may store, across every application. */
export const MAX_TOTAL_UPLOAD_BYTES = 100 * 1024 * 1024;

/** Attachments one application may carry. */
export const MAX_ATTACHMENTS_PER_APPLICATION = 20;

const BYTES_PER_MB = 1024 * 1024;

/** Renders a byte count the way both the error messages and Settings want it. */
export function formatMegabytes(bytes: number): string {
  const megabytes = bytes / BYTES_PER_MB;

  return `${megabytes.toFixed(Number.isInteger(megabytes) ? 0 : 1)} MB`;
}
