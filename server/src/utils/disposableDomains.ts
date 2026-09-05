import { readFileSync } from 'node:fs';
import path from 'node:path';
import { logger } from '@/config/logger';

const LIST_FILENAME = 'disposable-email-domains.txt';

/**
 * Where the bundled list might be, in the order worth trying.
 *
 * `process.cwd()` covers `npm start` and `npm run dev`, both of which run from
 * the server workspace. `__dirname` covers everything else, and resolves to the
 * same `server/data` directory from `src/utils` and from `dist/utils` alike -
 * which is what keeps the compiled build working without a copy step in the
 * build script that someone would eventually forget.
 */
function candidatePaths(): string[] {
  return [
    path.resolve(process.cwd(), 'data', LIST_FILENAME),
    path.resolve(__dirname, '..', '..', 'data', LIST_FILENAME),
  ];
}

/** `# comment` and blank lines out, lowercased and trimmed. */
export function parseDomainList(contents: string): Set<string> {
  const domains = new Set<string>();

  for (const line of contents.split(/\r?\n/)) {
    const domain = line.trim().toLowerCase();
    if (domain.length === 0 || domain.startsWith('#')) continue;
    domains.add(domain);
  }

  return domains;
}

let cached: Set<string> | undefined;

/**
 * Reads the bundled list once, and **fails open**.
 *
 * A missing, unreadable or empty file yields an empty set, which makes every
 * address allowed. That is the whole point: this list exists to make signup
 * slightly less attractive to throwaway addresses, and an anti-abuse measure
 * that can take registration down when its own data file is missing has traded
 * a nuisance for an outage. The failure is logged once, loudly, so it is
 * fixable - but it is never fatal.
 *
 * Reading synchronously is deliberate. The set has to exist before the first
 * registration is answered, and one small file read on first use is cheaper than
 * the coordination an async cache would need to avoid a thundering herd.
 */
export function loadDisposableDomains(): Set<string> {
  if (cached) return cached;

  for (const candidate of candidatePaths()) {
    try {
      cached = parseDomainList(readFileSync(candidate, 'utf8'));
      logger.debug('Disposable email list loaded', {
        path: candidate,
        domains: cached.size,
      });
      return cached;
    } catch {
      // Try the next candidate; only the last failure is worth reporting.
    }
  }

  logger.warn('Disposable email list could not be read; registration will accept every domain', {
    tried: candidatePaths(),
  });

  cached = new Set<string>();
  return cached;
}

/** Drops the cache so a test can exercise the fail-open path. */
export function resetDisposableDomainCache(): void {
  cached = undefined;
}

/** The domain part of an address, lowercased. Empty when there is not exactly one `@`. */
export function emailDomain(email: string): string {
  const parts = email.trim().toLowerCase().split('@');

  return parts.length === 2 ? parts[1] : '';
}

export function isDisposableEmail(email: string): boolean {
  const domain = emailDomain(email);

  return domain.length > 0 && loadDisposableDomains().has(domain);
}
