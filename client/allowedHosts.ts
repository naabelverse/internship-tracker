/**
 * Builds the `allowedHosts` list for Vite's dev and preview servers.
 *
 * Vite rejects any request whose `Host` header it does not recognise, which is a
 * real defence rather than a nuisance: without it a page can point a domain it
 * controls at a server it does not, and read back whatever that server returns
 * (DNS rebinding). The fix for a blocked deployment is therefore to name the
 * hosts that are genuinely expected, never to disable the check.
 *
 * Three sources, in order of how specific they are:
 *
 *  1. `VITE_APP_URL` — the deployed client origin, which every deployment already
 *     has to set for canonical URLs, the sitemap and the OG tags. Reusing it means
 *     a custom domain needs no additional configuration at all.
 *  2. A platform suffix, so a Railway-assigned subdomain works before a custom
 *     domain exists and keeps working if the platform reassigns it. Vite treats a
 *     leading dot as "this host and any subdomain of it".
 *  3. `ALLOWED_HOSTS`, comma-separated, for anything the first two miss — a second
 *     domain during a migration, or a preview environment.
 *
 * Note what is deliberately *absent*: `localhost` and the loopback addresses.
 * Vite allows any IPv4 literal, `localhost` and `*.localhost` unconditionally,
 * before this list is consulted, so listing them would be dead configuration and
 * would imply local development depends on this list. It does not.
 *
 * Takes the environment as an argument rather than reading `process.env`, so it
 * stays a pure function the test suite can drive directly, and so it needs no
 * Node type definitions — this module is compiled by both the app and the
 * build-tooling TypeScript projects, and only the latter has them.
 */

/**
 * Hosts assigned by the platform this app deploys to. The leading dot is Vite's
 * subdomain-wildcard syntax, matching the bare domain and any subdomain of it.
 */
const PLATFORM_HOST_SUFFIXES = ['.up.railway.app'];

/** Reads the hostname out of a URL, ignoring anything unparseable. */
function hostnameOf(value: string | undefined): string | undefined {
  if (!value) return undefined;

  try {
    // Vite strips the port before matching, so the port must not be included.
    return new URL(value).hostname || undefined;
  } catch {
    return undefined;
  }
}

/** Splits a comma-separated list, dropping blanks and surrounding whitespace. */
function splitList(value: string | undefined): string[] {
  if (!value) return [];

  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/** The value handed to Vite's `server.allowedHosts` and `preview.allowedHosts`. */
export function buildAllowedHosts(env: Record<string, string | undefined>): string[] {
  const hosts = new Set<string>(PLATFORM_HOST_SUFFIXES);

  const appHost = hostnameOf(env.VITE_APP_URL);
  if (appHost !== undefined) hosts.add(appHost);

  for (const extra of splitList(env.ALLOWED_HOSTS)) hosts.add(extra);

  return [...hosts];
}
