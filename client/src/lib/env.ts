/**
 * Reads and validates the browser-visible configuration once at module load, so
 * a malformed VITE_API_URL fails immediately instead of surfacing as a confusing
 * network error on the first request.
 */
function readUrl(value: string | undefined, fallback: string, name: string): string {
  const candidate = value?.trim() ? value.trim() : fallback;

  try {
    new URL(candidate);
  } catch {
    throw new Error(`${name} must be an absolute URL, received "${candidate}"`);
  }

  return candidate.replace(/\/+$/, '');
}

const apiUrl = readUrl(import.meta.env.VITE_API_URL, 'http://localhost:5000', 'VITE_API_URL');

/**
 * Anything but an explicit "false" leaves the demo button on. A deployment that
 * has not seeded a demo account still answers 404 from the API, so this flag is
 * about hiding a button that would not work, not about enforcement.
 */
function readFlag(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === '') return fallback;

  return value.trim().toLowerCase() !== 'false';
}

export const clientEnv = {
  apiUrl,
  /** Versioned base every request goes through; `/health` sits outside it. */
  apiBaseUrl: `${apiUrl}/api/v1`,
  appUrl: readUrl(import.meta.env.VITE_APP_URL, 'http://localhost:5173', 'VITE_APP_URL'),
  demoEnabled: readFlag(import.meta.env.VITE_DEMO_ENABLED, true),
} as const;
