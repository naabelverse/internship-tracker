import { create } from 'zustand';
import { THEME_PREFERENCES, type ThemePreference } from '@/types/user';

/** Must match the literal in the inline boot script in `index.html`. */
export const THEME_STORAGE_KEY = 'internship-tracker.theme';

/**
 * Marks a choice made while signed out that the account has not seen yet. It
 * lives in storage rather than memory because Google sign-in leaves the page.
 */
const PENDING_STORAGE_KEY = 'internship-tracker.theme.pending';

/**
 * Reports, and forgets, whether a signed-out choice is waiting for the account.
 * One-shot, so only the first sign-in after the choice carries it.
 */
export function takePendingChoice(): boolean {
  try {
    const pending = window.localStorage.getItem(PENDING_STORAGE_KEY) !== null;
    window.localStorage.removeItem(PENDING_STORAGE_KEY);
    return pending;
  } catch {
    return false;
  }
}

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
  /** A signed-out choice: device only, until the next sign-in carries it to the account. */
  setPreference: (preference: ThemePreference) => void;
  /**
   * Adopts the preference stored on the account, which outranks whatever this
   * device had cached once it arrives.
   */
  adoptAccountPreference: (preference: ThemePreference) => void;
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
        window.localStorage.setItem(PENDING_STORAGE_KEY, '1');
      } catch {
        // A rejected write only costs persistence, not the theme itself.
      }

      applyTheme(resolved);
      set({ preference: next, resolved });
    },
    // Precedence: local storage wins until the account value arrives, because it
    // is the only value that exists before the network answers and it is what
    // stops the flash. From then on the account wins and is written back into
    // local storage, so the next cold load paints the account's choice. Without
    // that write-back, changing the theme on one device would never reach
    // another. A no-op when they already agree, so a refetch cannot loop.
    adoptAccountPreference: (next) => {
      if (next === get().preference) return;

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
