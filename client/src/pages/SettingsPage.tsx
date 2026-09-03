import { PhasePlaceholder } from '@/pages/PhasePlaceholder';

export function SettingsPage(): JSX.Element {
  return (
    <PhasePlaceholder
      phase={9}
      title="Settings"
      description="Profile, password, notification preferences, timezone, data export and account deletion."
    />
  );
}
