import { create } from 'zustand';
import { THEME_PREFERENCES, type ThemePreference } from '@/types/user';

/** Must match the literal in the inline boot script in `index.html`. */
export const THEME_STORAGE_KEY = 'internship-tracker.theme';

/** SPEC section 6: dark is the default when the visitor has expressed no preference. */
export const DEFAULT_THEME_PREFERENCE: ThemePreference = 'dark';

export type ResolvedTheme = 'light' | 'dark';

function isThemePreference(value: unknown): value is ThemePreference {
  return THEME_PREFERENCES.includes(value as ThemePreference);
}

/** Reads the stored preference, tolerating storage that throws in private modes. */
export function readStoredPreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(stored) ? stored : DEFAULT_THEME_PREFERENCE;
  } catch {
    return DEFAULT_THEME_PREFERENCE;
  }
}

/** Turns a preference into the theme actually painted, consulting the OS for `system`. */
export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference !== 'system') return preference;

  const prefersLight =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: light)').matches;

  return prefersLight ? 'light' : 'dark';
}

function applyTheme(resolved: ResolvedTheme): void {
  const root = document.documentElement;
  root.setAttribute('data-theme', resolved);
  root.style.colorScheme = resolved;
}

interface ThemeState {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
  /** Re-resolves without changing the preference, for OS-level theme changes. */
  syncWithSystem: () => void;
}

export const useThemeStore = create<ThemeState>((set, get) => {
  const preference = readStoredPreference();

  return {
    preference,
    // The inline script already painted this; recomputing it here keeps React's
    // view of the world identical to the DOM instead of asserting a new one.
    resolved: resolveTheme(preference),
    setPreference: (next) => {
      const resolved = resolveTheme(next);

      try {
        window.localStorage.setItem(THEME_STORAGE_KEY, next);
      } catch {
        // A rejected write only costs persistence, not the theme itself.
      }

      applyTheme(resolved);
      set({ preference: next, resolved });
    },
    syncWithSystem: () => {
      const resolved = resolveTheme(get().preference);
      if (resolved === get().resolved) return;

      applyTheme(resolved);
      set({ resolved });
    },
  };
});
