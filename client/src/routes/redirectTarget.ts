import { paths } from '@/routes/paths';

/**
 * The path `ProtectedRoute` stashed in router state before bouncing to /login.
 *
 * `PublicOnlyRoute` and the login mutation both read it, so whichever of the two
 * redirects wins the race after a successful sign in, the user lands in the same
 * place. Only a same-origin absolute path is accepted: `//host` is a protocol
 * relative URL, so allowing it would turn this into an open redirect.
 *
 * Prefix checks alone are not enough, because the browser's URL parser reads a
 * backslash as a slash and drops tabs and newlines, so `/\host` and `/<tab>/host`
 * both resolve to `//host`. The path is therefore also resolved the way the
 * browser would, and refused unless it stays on this origin.
 */
export function readRedirectTarget(state: unknown): string {
  const from = (state as { from?: unknown } | null)?.from;

  if (
    typeof from !== 'string' ||
    !from.startsWith('/') ||
    from.startsWith('//') ||
    !staysOnThisOrigin(from)
  ) {
    return paths.dashboard;
  }

  return from;
}

function staysOnThisOrigin(path: string): boolean {
  const { origin } = window.location;
  try {
    return new URL(path, origin).origin === origin;
  } catch {
    // `URL` throws on input it cannot parse at all, such as an empty host.
    return false;
  }
}
