import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '@/config/env';
import { UNSUBSCRIBE_CATEGORIES, type UnsubscribeCategory } from '@/mail/types';

/**
 * One-click unsubscribe links for the two non-transactional emails.
 *
 * A link that lands on the sign-in page is not an unsubscribe: the person who
 * most wants out is the one least willing to log in for it. So the link carries
 * a keyed token that identifies the account and the stream on its own.
 *
 * The token deliberately never expires. An unsubscribe link has to keep working
 * for as long as the message carrying it exists, and there is nothing to protect
 * by ageing it out: forging one requires the signing key, and the only thing it
 * can ever do is switch a preference off.
 */

/**
 * The key is derived from `JWT_ACCESS_SECRET` rather than being it, so an
 * unsubscribe token can never be confused with — or ground against — a token
 * that grants access.
 */
const KEY_LABEL = 'internship-tracker/unsubscribe/v1';

function signingKey(): Buffer {
  return createHmac('sha256', env.JWT_ACCESS_SECRET).update(KEY_LABEL).digest();
}

function signature(userId: string, category: UnsubscribeCategory): string {
  return createHmac('sha256', signingKey()).update(`${userId}.${category}`).digest('base64url');
}

function isUnsubscribeCategory(value: string): value is UnsubscribeCategory {
  return (UNSUBSCRIBE_CATEGORIES as readonly string[]).includes(value);
}

export interface UnsubscribeClaim {
  userId: string;
  category: UnsubscribeCategory;
}

export function signUnsubscribeToken(userId: string, category: UnsubscribeCategory): string {
  return `${userId}.${category}.${signature(userId, category)}`;
}

/** Returns the claim, or null for anything this server did not issue. */
export function verifyUnsubscribeToken(token: string): UnsubscribeClaim | null {
  const parts = token.split('.');

  if (parts.length !== 3) return null;

  const [userId, category, provided] = parts;

  if (!isUnsubscribeCategory(category)) return null;

  const expected = Buffer.from(signature(userId, category));
  const candidate = Buffer.from(provided);

  // `timingSafeEqual` throws on a length mismatch, and the throw would itself
  // disclose the expected length, so lengths are compared first and the
  // constant-time comparison runs only once they already agree.
  if (expected.length !== candidate.length) return null;
  if (!timingSafeEqual(expected, candidate)) return null;

  return { userId, category };
}

export function unsubscribeUrl(userId: string, category: UnsubscribeCategory): string {
  const token = encodeURIComponent(signUnsubscribeToken(userId, category));

  return `${env.API_URL}/api/v1/email/unsubscribe?token=${token}`;
}

/**
 * RFC 8058 one-click headers. Gmail and Outlook surface their own "Unsubscribe"
 * control from these and POST to the address themselves, which is worth more for
 * deliverability than the footer link alone.
 */
export function unsubscribeHeaders(url: string): Record<string, string> {
  return {
    'List-Unsubscribe': `<${url}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}
