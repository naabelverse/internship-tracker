/**
 * The single sanctioned console boundary in the client. Everything else goes
 * through here so `no-console` stays on repo-wide and there is one place to
 * swap in Sentry (Phase 14).
 *
 * Errors are reported in every environment except tests, where a deliberately
 * thrown error in a test would otherwise print a misleading stack.
 */
const shouldReport = !import.meta.env.MODE.startsWith('test');

export const logger = {
  error(message: string, context?: unknown): void {
    if (!shouldReport) return;
    // eslint-disable-next-line no-console -- see the module comment: this is the one place console is allowed.
    console.error(`[internship-tracker] ${message}`, context ?? '');
  },
  warn(message: string, context?: unknown): void {
    if (!shouldReport) return;
    // eslint-disable-next-line no-console -- see the module comment.
    console.warn(`[internship-tracker] ${message}`, context ?? '');
  },
};
