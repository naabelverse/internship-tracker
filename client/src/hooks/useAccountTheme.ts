import { useEffect } from 'react';
import { useSession } from '@/hooks/useSession';
import { useThemeStore } from '@/store/themeStore';

/**
 * Reconciles the theme stored on the account with the one cached on this device.
 *
 * Precedence, in one sentence: local storage wins until the account value loads,
 * then the account wins and is written back into local storage.
 *
 * Local storage has to win first because it is the only value that exists before
 * `/auth/me` answers — it is what the inline script in `index.html` reads to
 * paint the correct theme before React mounts. Once the account value is in
 * hand it takes over, because it is the durable cross-device preference and the
 * cached copy is only a device-local stand-in for it. Writing it back is what
 * makes the *next* cold load paint the account's choice without a flash.
 *
 * Signing out and back in as somebody else therefore lands on their theme, not
 * on whatever the previous person left on the machine.
 */
export function useAccountTheme(): void {
  const { user } = useSession();
  const adoptAccountPreference = useThemeStore((state) => state.adoptAccountPreference);

  useEffect(() => {
    if (!user) return;

    adoptAccountPreference(user.theme);
  }, [user, adoptAccountPreference]);
}
