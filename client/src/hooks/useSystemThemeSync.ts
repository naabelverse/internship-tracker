import { useEffect } from 'react';
import { useThemeStore } from '@/store/themeStore';

/**
 * Re-resolves the theme when the OS switches, but only while the preference is
 * `system`. An explicit light or dark choice must survive the OS changing.
 */
export function useSystemThemeSync(): void {
  const preference = useThemeStore((state) => state.preference);
  const syncWithSystem = useThemeStore((state) => state.syncWithSystem);

  useEffect(() => {
    if (preference !== 'system' || typeof window.matchMedia !== 'function') return;

    const query = window.matchMedia('(prefers-color-scheme: light)');
    query.addEventListener('change', syncWithSystem);

    return () => {
      query.removeEventListener('change', syncWithSystem);
    };
  }, [preference, syncWithSystem]);
}
