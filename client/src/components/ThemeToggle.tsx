import { cn } from '@/lib/cn';
import { MonitorIcon, MoonIcon, SunIcon } from '@/components/ui/icons';
import { useThemeStore } from '@/store/themeStore';
import { THEME_PREFERENCES, type ThemePreference } from '@/types/user';

const OPTIONS: Record<ThemePreference, { label: string; Icon: typeof SunIcon }> = {
  light: { label: 'Light theme', Icon: SunIcon },
  dark: { label: 'Dark theme', Icon: MoonIcon },
  system: { label: 'Match system theme', Icon: MonitorIcon },
};

/**
 * A three-way segmented control rather than a two-state switch, because the
 * account carries `light | dark | system` and Phase 9 syncs this to the server.
 */
export function ThemeToggle(): JSX.Element {
  const preference = useThemeStore((state) => state.preference);
  const setPreference = useThemeStore((state) => state.setPreference);

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
              setPreference(option);
            }}
            className={cn(
              'rounded-[0.4rem] p-1.5 transition-colors',
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
