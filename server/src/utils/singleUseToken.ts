import { createHash, randomBytes } from 'node:crypto';

/** 24 hours, per SPEC section 5. */
export const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

/** 30 minutes, per SPEC section 5. */
export const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;

export interface SingleUseToken {
  /** Goes in the email and nowhere else. Never logged, never stored. */
  token: string;
  tokenHash: string;
  expiresAt: Date;
}

/**
 * Verification and reset tokens live in exactly two places: the email that
 * carries them, and a digest in the user document. A leaked database therefore
 * cannot be replayed against `/auth/verify-email` or `/auth/reset-password`.
 *
 * A plain SHA-256 rather than the HMAC the refresh tokens use, deliberately.
 * These are 32 bytes of CSPRNG output with a life measured in minutes or hours,
 * so there is no low-entropy secret for an attacker to grind offline and nothing
 * for a keyed hash to protect. A bare digest also keeps the lookup one indexed
 * equality match instead of a scan.
 */
export function issueSingleUseToken(ttlMs: number): SingleUseToken {
  const token = randomBytes(32).toString('base64url');

  return {
    token,
    tokenHash: hashSingleUseToken(token),
    expiresAt: new Date(Date.now() + ttlMs),
  };
}

export function hashSingleUseToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
