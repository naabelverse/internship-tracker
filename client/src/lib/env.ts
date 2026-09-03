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

export const clientEnv = {
  apiUrl,
  /** Versioned base every request goes through; `/health` sits outside it. */
  apiBaseUrl: `${apiUrl}/api/v1`,
  appUrl: readUrl(import.meta.env.VITE_APP_URL, 'http://localhost:5173', 'VITE_APP_URL'),
} as const;
