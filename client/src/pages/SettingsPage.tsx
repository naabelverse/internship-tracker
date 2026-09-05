import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { DangerZoneSection } from '@/features/settings/DangerZoneSection';
import { DataSection } from '@/features/settings/DataSection';
import { EmailSection } from '@/features/settings/EmailSection';
import { PasswordSection } from '@/features/settings/PasswordSection';
import { PreferencesSection } from '@/features/settings/PreferencesSection';
import { ProfileSection } from '@/features/settings/ProfileSection';
import { SessionsSection } from '@/features/settings/SessionsSection';
import { UsageSection } from '@/features/settings/UsageSection';
import { useSession } from '@/hooks/useSession';

/**
 * Settings. Every section writes through `PATCH /auth/me` except the password,
 * which has its own endpoint because it needs the current password.
 *
 * The page reads the session the shell has already resolved rather than issuing
 * its own request: by the time a protected route renders, the bootstrap has run.
 */
export function SettingsPage(): JSX.Element {
  const { status, user } = useSession();

  if (status === 'pending') {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-40" label="Loading settings" />
        {[0, 1, 2].map((section) => (
          <Skeleton key={section} className="h-56 w-full" />
        ))}
      </div>
    );
  }

  if (!user) {
    return (
      <ErrorState
        error={null}
        fallback="Your account could not be read. Try signing in again."
        onRetry={() => {
          window.location.reload();
        }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-content">Settings</h1>
        <p className="mt-0.5 text-sm text-content-muted">Your profile, security and preferences.</p>
      </header>

      <div className="max-w-3xl space-y-4">
        <ProfileSection user={user} />
        <EmailSection user={user} />
        <PreferencesSection user={user} />
        <PasswordSection />
        <SessionsSection />
        <UsageSection />
        <DataSection />
        <DangerZoneSection />
      </div>
    </div>
  );
}

/** Default export as well, so `React.lazy` can import this route. */
export default SettingsPage;
