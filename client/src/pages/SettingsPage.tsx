import type { ReactNode } from 'react';
import { ErrorState } from '@/components/ui/ErrorState';
import { PageHeader } from '@/components/ui/PageHeader';
import { Skeleton } from '@/components/ui/Skeleton';
import { DangerZoneSection } from '@/features/settings/DangerZoneSection';
import { DataSection } from '@/features/settings/DataSection';
import { EmailSection } from '@/features/settings/EmailSection';
import { PasswordSection } from '@/features/settings/PasswordSection';
import { PreferencesSection } from '@/features/settings/PreferencesSection';
import { ProfileSection } from '@/features/settings/ProfileSection';
import { SessionsSection } from '@/features/settings/SessionsSection';
import { UsageSection } from '@/features/settings/UsageSection';
import { SettingsNav, type SettingsNavItem } from '@/features/settings/SettingsNav';
import { useSession } from '@/hooks/useSession';

/** Page order, anchor ids and the side navigation's labels, defined once. */
const SECTIONS = [
  { id: 'profile', label: 'Profile' },
  { id: 'email', label: 'Email address' },
  { id: 'preferences', label: 'Preferences' },
  { id: 'password', label: 'Password' },
  { id: 'sessions', label: 'Signed in devices' },
  { id: 'usage', label: 'Storage and limits' },
  { id: 'data', label: 'Your data' },
  { id: 'close-account', label: 'Close your account' },
] as const satisfies readonly SettingsNavItem[];

type SectionId = (typeof SECTIONS)[number]['id'];

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
      <div className="mx-auto max-w-3xl space-y-4">
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

  const content: Record<SectionId, ReactNode> = {
    profile: <ProfileSection user={user} />,
    email: <EmailSection user={user} />,
    preferences: <PreferencesSection user={user} />,
    password: <PasswordSection />,
    sessions: <SessionsSection />,
    usage: <UsageSection />,
    data: <DataSection />,
    'close-account': <DangerZoneSection />,
  };

  return (
    <div className="mx-auto max-w-3xl xl:grid xl:max-w-5xl xl:grid-cols-[minmax(0,1fr)_11rem] xl:gap-x-10">
      <div className="min-w-0 space-y-4">
        <PageHeader title="Settings" description="Your profile, security and preferences." />

        {SECTIONS.map(({ id }) => (
          <div key={id} id={id} className="scroll-mt-24">
            {content[id]}
          </div>
        ))}
      </div>

      <SettingsNav items={SECTIONS} />
    </div>
  );
}

/** Default export as well, so `React.lazy` can import this route. */
export default SettingsPage;
