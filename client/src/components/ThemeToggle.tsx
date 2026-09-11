import { useRef, type KeyboardEvent } from 'react';
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

/** Which neighbour each arrow key moves to, in the visual order of `THEME_PREFERENCES`. */
const ARROW_STEP: Record<string, 1 | -1> = {
  ArrowRight: 1,
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
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
 *
 * The selected state is one thumb that slides between the options rather than
 * a background each button paints for itself: two buttons cross-fading read as
 * two things changing, a thumb moving reads as one choice moving. The buttons
 * are exactly the thumb's size with no gap between them, which is what lets
 * the thumb travel in whole widths of itself and land under each one.
 *
 * Keyboard follows the APG radio group pattern: the group is a single Tab stop
 * on the checked option, and the arrow keys move both focus and the selection.
 */
export function ThemeToggle(): JSX.Element {
  const preference = useThemeStore((state) => state.preference);
  const setPreference = useThemeStore((state) => state.setPreference);
  const { isAuthenticated } = useSession();
  const updatePreferences = useUpdatePreferences();
  const buttons = useRef<Partial<Record<ThemePreference, HTMLButtonElement | null>>>({});

  const choose = (option: ThemePreference): void => {
    if (option === preference) return;

    if (isAuthenticated) {
      updatePreferences.mutate({ theme: option });
      return;
    }

    setPreference(option);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const step = ARROW_STEP[event.key];
    if (step === undefined) return;

    event.preventDefault();

    const count = THEME_PREFERENCES.length;
    const index = THEME_PREFERENCES.indexOf(preference);
    const next = THEME_PREFERENCES[(index + step + count) % count] ?? preference;

    choose(next);
    buttons.current[next]?.focus();
  };

  const selectedIndex = THEME_PREFERENCES.indexOf(preference);

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      onKeyDown={onKeyDown}
      className="relative flex rounded-control border border-border-strong bg-surface p-0.5"
    >
      {/*
        The thumb. Painted first so the buttons stack above it; a transform
        rather than `left` so the slide never triggers layout. Reduced-motion
        users get the same end state without the travel.
      */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-0.5 top-0.5 h-7 w-7 rounded-chip bg-primary-fill transition-transform motion-reduce:transition-none"
        style={{ transform: `translateX(${String(selectedIndex * 100)}%)` }}
      />

      {THEME_PREFERENCES.map((option) => {
        const { label, Icon } = OPTIONS[option];
        const selected = preference === option;

        return (
          <button
            key={option}
            ref={(node) => {
              buttons.current[option] = node;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={label}
            tabIndex={selected ? 0 : -1}
            onClick={() => {
              choose(option);
            }}
            className={cn(
              'relative flex h-7 w-7 items-center justify-center rounded-chip transition-colors',
              selected
                ? 'text-primary-fill-fg'
                : 'text-content-subtle hover:bg-content/10 hover:text-content',
            )}
          >
            <Icon className="h-4 w-4" />
          </button>
        );
      })}
    </div>
  );
}
