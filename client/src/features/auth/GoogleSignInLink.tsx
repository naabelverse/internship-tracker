import type { MouseEventHandler } from 'react';
import { googleStartUrl, type GoogleIntent } from '@/features/auth/googleSignIn';
import { clientEnv } from '@/lib/env';

interface GoogleSignInLinkProps {
  intent: GoogleIntent;
  /** Lets the register form stop the navigation until the terms are accepted. */
  onClick?: MouseEventHandler<HTMLAnchorElement>;
}

/**
 * "Continue with Google", below a form's own submit button. A link rather than a
 * button because it leaves the app, which is also why it works without any
 * JavaScript request: the API owns the whole round trip.
 */
export function GoogleSignInLink({ intent, onClick }: GoogleSignInLinkProps): JSX.Element | null {
  if (!clientEnv.googleAuthEnabled) return null;

  return (
    <>
      <div className="flex items-center gap-3 text-xs text-content-muted" aria-hidden="true">
        <span className="h-px flex-1 bg-border" />
        or
        <span className="h-px flex-1 bg-border" />
      </div>
      <a
        href={googleStartUrl(intent)}
        onClick={onClick}
        className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-control border border-border bg-surface px-4 text-sm font-medium text-content transition-colors hover:bg-surface-muted"
      >
        <img src="/google-g.svg" alt="" width={18} height={18} />
        Continue with Google
      </a>
    </>
  );
}
