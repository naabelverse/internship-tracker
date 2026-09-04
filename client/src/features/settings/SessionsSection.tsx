import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { SettingsSection } from '@/features/settings/SettingsSection';
import {
  useLogoutEverywhere,
  useRevokeSession,
  useSessions,
} from '@/features/auth/useLifecycleMutations';
import { formatRelative } from '@/lib/formatters';
import type { ActiveSession } from '@/api/auth';

/**
 * A readable name for a user agent string.
 *
 * Deliberately crude. The alternative is a UA parsing dependency for a label
 * nobody makes a decision on: the IP and the last-used time are what actually
 * identify a device to its owner, and "this device" is marked by the server.
 */
function describeDevice(userAgent?: string): string {
  if (!userAgent) return 'Unknown device';

  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /OPR\//.test(userAgent)
      ? 'Opera'
      : /Chrome\//.test(userAgent)
        ? 'Chrome'
        : /Safari\//.test(userAgent)
          ? 'Safari'
          : /Firefox\//.test(userAgent)
            ? 'Firefox'
            : 'Browser';

  const platform = /Windows/.test(userAgent)
    ? 'Windows'
    : /Android/.test(userAgent)
      ? 'Android'
      : /iPhone|iPad|iOS/.test(userAgent)
        ? 'iOS'
        : /Mac OS X|Macintosh/.test(userAgent)
          ? 'macOS'
          : /Linux/.test(userAgent)
            ? 'Linux'
            : 'Unknown platform';

  return `${browser} on ${platform}`;
}

function SessionRow({ session }: { session: ActiveSession }): JSX.Element {
  const revoke = useRevokeSession();
  const label = describeDevice(session.userAgent);

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-control border border-border px-3 py-2.5">
      <div className="min-w-0 text-sm">
        <p className="font-medium text-content">
          {label}
          {session.current && (
            <span className="ml-2 rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary">
              This device
            </span>
          )}
        </p>
        <p className="text-content-muted">
          {session.ip ?? 'Unknown address'} · last used{' '}
          {formatRelative(session.lastUsedAt ?? session.createdAt)}
        </p>
      </div>

      <Button
        type="button"
        variant="secondary"
        size="sm"
        isLoading={revoke.isPending}
        loadingLabel="Signing out"
        aria-label={
          session.current
            ? 'Sign out this device'
            : `Sign out ${label} at ${session.ip ?? 'unknown address'}`
        }
        onClick={() => {
          revoke.mutate(session);
        }}
      >
        {session.current ? 'Sign out here' : 'Sign out'}
      </Button>
    </li>
  );
}

/**
 * The signed in devices, read straight from the refresh tokens. There is no
 * second notion of a session anywhere in the app: a row here is a live token,
 * and `current` is decided server-side by hashing the cookie the request
 * arrived with, so the client never has to guess which row is its own.
 */
export function SessionsSection(): JSX.Element {
  const sessions = useSessions();
  const logoutEverywhere = useLogoutEverywhere();

  return (
    <SettingsSection
      title="Signed in devices"
      description="Every device with a live session. Signing one out takes effect immediately."
      footer={
        <Button
          type="button"
          variant="secondary"
          isLoading={logoutEverywhere.isPending}
          loadingLabel="Signing out"
          onClick={() => {
            logoutEverywhere.mutate();
          }}
        >
          Sign out everywhere
        </Button>
      }
    >
      {sessions.isPending && (
        <div className="space-y-2">
          <Skeleton className="h-14 w-full" label="Loading your sessions" />
          <Skeleton className="h-14 w-full" />
        </div>
      )}

      {sessions.isError && (
        <ErrorState
          error={sessions.error}
          fallback="Your sessions could not be loaded."
          onRetry={() => {
            void sessions.refetch();
          }}
          isRetrying={sessions.isFetching}
        />
      )}

      {sessions.isSuccess &&
        (sessions.data.length === 0 ? (
          <p className="text-sm text-content-muted">No other devices are signed in.</p>
        ) : (
          <ul className="space-y-2">
            {sessions.data.map((session) => (
              <SessionRow key={session.id} session={session} />
            ))}
          </ul>
        ))}

      <p className="text-sm text-content-muted">
        Signing out everywhere ends this session too, so you will be asked to sign in again.
      </p>
    </SettingsSection>
  );
}
