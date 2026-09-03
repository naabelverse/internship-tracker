import { paths } from '@/routes/paths';

/**
 * The path `ProtectedRoute` stashed in router state before bouncing to /login.
 *
 * `PublicOnlyRoute` and the login mutation both read it, so whichever of the two
 * redirects wins the race after a successful sign in, the user lands in the same
 * place. Only a same-origin absolute path is accepted: `//host` is a protocol
 * relative URL, so allowing it would turn this into an open redirect.
 */
export function readRedirectTarget(state: unknown): string {
  const from = (state as { from?: unknown } | null)?.from;

  if (typeof from !== 'string' || !from.startsWith('/') || from.startsWith('//')) {
    return paths.dashboard;
  }

  return from;
}
