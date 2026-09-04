import { Button } from '@/components/ui/Button';
import { useResendVerification } from '@/features/auth/useLifecycleMutations';
import {
  daysRemaining,
  verificationState,
  type VerificationState,
} from '@/features/auth/verificationWindow';
import { useSession } from '@/hooks/useSession';

const TONE: Record<Exclude<VerificationState, 'verified'>, string> = {
  grace: 'border-border bg-surface-muted text-content',
  urgent: 'border-warning/40 bg-warning/10 text-content',
  expired: 'border-danger/40 bg-danger/10 text-content',
};

/**
 * The app-wide unverified banner, per SPEC section 5.
 *
 * Its tone escalates with the window rather than saying the same thing for seven
 * days: informative at first, a countdown in the last three, and a plain
 * statement of what has already stopped working once the window closes. The
 * escalation is derived from `createdAt` and `emailVerified`, the two fields
 * `/auth/me` returns; see `verificationWindow`.
 */
export function VerificationBanner(): JSX.Element | null {
  const { user } = useSession();
  const resend = useResendVerification();
  const state = verificationState(user);

  if (!user || state === 'verified') return null;

  const address = user.pendingEmail ?? user.email;
  const left = daysRemaining(user);

  const message =
    state === 'expired'
      ? `Confirm ${address} to start making changes again. Until you do, your data is readable but read-only.`
      : state === 'urgent'
        ? `Confirm ${address} within ${String(left)} ${left === 1 ? 'day' : 'days'} or you will not be able to make changes.`
        : `We sent a confirmation link to ${address}. Confirming it keeps your account fully editable.`;

  return (
    <div
      role={state === 'expired' ? 'alert' : 'status'}
      aria-live={state === 'expired' ? 'assertive' : 'polite'}
      className={`flex flex-wrap items-center justify-between gap-3 border-b px-4 py-2.5 text-sm sm:px-6 ${TONE[state]}`}
    >
      <p className="min-w-0">
        <span className="font-medium">
          {state === 'expired' ? 'Editing is paused.' : 'Confirm your email address.'}
        </span>{' '}
        {message}
      </p>

      <Button
        type="button"
        variant="secondary"
        size="sm"
        isLoading={resend.isPending}
        loadingLabel="Sending"
        onClick={() => {
          resend.mutate();
        }}
      >
        Resend link
      </Button>
    </div>
  );
}
