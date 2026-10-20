import { randomBytes } from 'node:crypto';
import { User, type UserDocument } from '@/models/User';
import { createSession, type IssuedSession, type SessionContext } from '@/services/token.service';
import { isDisposableEmail } from '@/utils/disposableDomains';

/** What the Google strategy hands over once Google has authenticated someone. */
export interface GoogleIdentity {
  googleId: string;
  email: string;
  /** Google's own `email_verified`: whether Google has proven the address belongs to this account. */
  emailVerified: boolean;
  name: string;
}

export const GOOGLE_INTENTS = ['login', 'register'] as const;
export type GoogleIntent = (typeof GOOGLE_INTENTS)[number];

/** What the visitor asked for before leaving for Google, carried through the OAuth state. */
export interface GoogleSignInRequest {
  /** Only `register` may create an account: that is the page where the terms were accepted. */
  intent: GoogleIntent;
  timezone?: string;
}

/** Stable codes the client turns into a message after the redirect back. */
export type GoogleRefusal =
  | 'GOOGLE_EMAIL_UNVERIFIED'
  | 'NO_ACCOUNT'
  | 'ACCOUNT_UNVERIFIED'
  | 'GOOGLE_ACCOUNT_MISMATCH'
  | 'ACCOUNT_CLOSED'
  | 'DEMO_ACCOUNT'
  | 'DISPOSABLE_EMAIL';

export type GoogleSignInOutcome =
  { ok: true; user: UserDocument; session: IssuedSession } | { ok: false; code: GoogleRefusal };

const NAME_MIN = 2;
const NAME_MAX = 60;

function accountName(identity: GoogleIdentity): string {
  const candidates = [identity.name.trim(), identity.email.split('@')[0] ?? ''];
  const usable = candidates.find((candidate) => candidate.length >= NAME_MIN);

  return (usable ?? 'New user').slice(0, NAME_MAX);
}

async function signIn(user: UserDocument, context: SessionContext): Promise<IssuedSession> {
  user.lastLoginAt = new Date();
  await user.save();

  return createSession(user._id, context);
}

/**
 * Signs a Google-authenticated visitor in, linking or creating the account.
 *
 * An existing account is matched by Google id first, then by email. Matching
 * by email links the Google id onto the account, and only when both sides have
 * proven the address: Google's `email_verified` and our own `emailVerified`.
 * Without the second, anyone could register a victim's address with a password
 * of their own, wait for the victim to "Continue with Google", and keep a
 * password into the victim's account. A refusal is an outcome, not a throw,
 * because the caller answers every refusal with the same kind of redirect.
 *
 * A created account gets a random password nobody knows. The password flows
 * stay intact: "Forgot password" sets a real one, exactly as for anyone else.
 */
export async function signInWithGoogle(
  identity: GoogleIdentity,
  request: GoogleSignInRequest,
  context: SessionContext,
): Promise<GoogleSignInOutcome> {
  if (!identity.emailVerified) return { ok: false, code: 'GOOGLE_EMAIL_UNVERIFIED' };

  const email = identity.email.trim().toLowerCase();
  const linked = await User.findOne({ googleId: identity.googleId });
  const user = linked ?? (await User.findOne({ email }));

  if (user) {
    if (user.isDemo) return { ok: false, code: 'DEMO_ACCOUNT' };
    if (user.deletedAt) return { ok: false, code: 'ACCOUNT_CLOSED' };

    if (!linked) {
      if (!user.emailVerified) return { ok: false, code: 'ACCOUNT_UNVERIFIED' };
      if (user.googleId) return { ok: false, code: 'GOOGLE_ACCOUNT_MISMATCH' };
      user.googleId = identity.googleId;
    }

    return { ok: true, user, session: await signIn(user, context) };
  }

  if (request.intent !== 'register') return { ok: false, code: 'NO_ACCOUNT' };
  if (isDisposableEmail(email)) return { ok: false, code: 'DISPOSABLE_EMAIL' };

  const created = new User({
    name: accountName(identity),
    email,
    password: randomBytes(32).toString('base64url'),
    googleId: identity.googleId,
    emailVerified: true,
    timezone: request.timezone ?? 'UTC',
    acceptedTermsAt: new Date(),
  });

  return { ok: true, user: created, session: await signIn(created, context) };
}
