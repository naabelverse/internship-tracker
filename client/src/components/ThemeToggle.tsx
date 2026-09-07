import { cn } from '@/lib/cn';
import { MonitorIcon, MoonIcon, SunIcon } from '@/components/ui/icons';
import { useUpdatePreferences } from '@/features/settings/useSettingsMutations';
import { useSession } from '@/hooks/useSession';
import { useThemeStore } from '@/store/themeStore';
import { THEME_PREFERENCES, type ThemePreference } from '@/types/user';

const OPTIONS: Record<ThemePreference, { label: string; Icon: typeof SunIcon }> = {
  light: { label: 'Light theme', Icon: SunIcon },
  dark: { label: 'Dark theme', Icon: MoonIcon },
  system: { label: 'Match system theme', Icon: MonitorIcon },
};

/**
 * A three-way segmented control rather than a two-state switch, because the
 * account carries `light | dark | system`.
 *
 * A choice is applied to this device immediately and then written to the
 * account, so it follows the user to their other devices. Applying first is
 * deliberate: waiting for the round trip before repainting would make the
 * control feel broken on a slow connection. `useUpdatePreferences` rolls the
 * local value back if the write fails, so the two cannot end up disagreeing.
 *
 * Signed out there is no account to write to, and the local preference is all
 * there is; it is overridden by the account's own value at the next sign in.
 */
export function ThemeToggle(): JSX.Element {
  const preference = useThemeStore((state) => state.preference);
  const setPreference = useThemeStore((state) => state.setPreference);
  const { isAuthenticated } = useSession();
  const updatePreferences = useUpdatePreferences();

  const choose = (option: ThemePreference): void => {
    if (option === preference) return;

    if (isAuthenticated) {
      updatePreferences.mutate({ theme: option });
      return;
    }

    setPreference(option);
  };

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="flex items-center gap-0.5 rounded-control border border-border bg-surface p-0.5"
    >
      {THEME_PREFERENCES.map((option) => {
        const { label, Icon } = OPTIONS[option];
        const selected = preference === option;

        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={label}
            onClick={() => {
              choose(option);
            }}
            className={cn(
              'rounded-chip p-1.5 transition-colors',
              selected
                ? 'bg-primary text-primary-fg'
                : 'text-content-subtle hover:bg-surface-muted hover:text-content',
            )}
          >
            <Icon className="h-4 w-4" />
          </button>
        );
      })}
    </div>
  );
}
