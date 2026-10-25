import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/ErrorState';
import { MonitorIcon } from '@/components/ui/icons';
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
    <li className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-control bg-surface-muted text-content-muted">
        <MonitorIcon className="h-4 w-4" />
      </span>

      <div className="min-w-0 flex-1 text-sm">
        <p className="flex flex-wrap items-center gap-2 font-medium text-content">
          {label}
          {session.current && (
            <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary">
              This device
            </span>
          )}
        </p>
        <p className="text-xs text-content-muted">
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
        <>
          <p className="mr-auto self-center text-xs text-content-subtle">
            Signing out everywhere includes this device.
          </p>
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
        </>
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
          <ul className="divide-y divide-border">
            {sessions.data.map((session) => (
              <SessionRow key={session.id} session={session} />
            ))}
          </ul>
        ))}
    </SettingsSection>
  );
}
