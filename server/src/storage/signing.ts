import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '@/config/env';

/**
 * Namespaced so a download signature can never be replayed as anything else that
 * happens to be signed with the same secret.
 */
const PURPOSE = 'attachment-download';

function computeSignature(key: string, expiresAt: number): string {
  return createHmac('sha256', env.JWT_ACCESS_SECRET)
    .update(`${PURPOSE}:${key}:${String(expiresAt)}`)
    .digest('hex');
}

export function signDownload(key: string, expiresAt: number): string {
  return computeSignature(key, expiresAt);
}

/**
 * Constant-time comparison, then an expiry check. Returns false rather than
 * throwing so the route can answer with one indistinguishable 404.
 */
export function verifyDownload(
  key: string,
  expiresAt: number,
  signature: string,
  now: Date = new Date(),
): boolean {
  if (!Number.isFinite(expiresAt) || expiresAt * 1000 <= now.getTime()) return false;

  const expected = Buffer.from(computeSignature(key, expiresAt), 'utf8');
  const provided = Buffer.from(signature, 'utf8');

  if (expected.length !== provided.length) return false;

  return timingSafeEqual(expected, provided);
}
