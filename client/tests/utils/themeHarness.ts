import { vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { resetRefreshState } from '@/api/refresh';
import { useAuthStore } from '@/store/authStore';
import { readStoredPreference, resolveTheme, useThemeStore } from '@/store/themeStore';

/** Answers `prefers-color-scheme` queries as an OS set to light or dark would. */
export function stubMatchMedia(prefersLight: boolean): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query.includes('prefers-color-scheme: light') ? prefersLight : !prefersLight,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

/**
 * Puts the theme store back to what a cold page load would produce, which is
 * whatever `index.html` found in local storage. The store is a module singleton
 * built once at import, so without this a second "boot" in the same file would
 * inherit the previous test's in-memory preference and prove nothing.
 */
export function bootThemeStoreFromStorage(): void {
  const preference = readStoredPreference();
  useThemeStore.setState({ preference, resolved: resolveTheme(preference) });
  document.documentElement.setAttribute('data-theme', resolveTheme(preference));
}

/**
 * A browser refresh: the tree and the in-memory session are gone, local storage
 * is not. Unlike `resetClientState` it keeps storage, because what survives a
 * reload is exactly what these cases are about. The session then comes back the
 * way a real reload brings it back, through `/auth/refresh` and `/auth/me`.
 */
export function simulateReload(): void {
  cleanup();
  resetRefreshState();
  useAuthStore.setState({ accessToken: null, user: null, status: 'pending' });
  bootThemeStoreFromStorage();
}
