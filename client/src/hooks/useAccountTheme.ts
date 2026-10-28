import { useEffect } from 'react';
import { useUpdatePreferences } from '@/features/settings/useSettingsMutations';
import { useSession } from '@/hooks/useSession';
import { takePendingChoice, useThemeStore } from '@/store/themeStore';

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
 *
 * Except a choice clicked while signed out, on the landing or auth pages. That
 * is newer than anything the account holds, so the sign-in right after it
 * writes it to the account instead of repainting over it. Only a click counts:
 * a value merely cached on the device still loses to the account.
 *
 * The demo account is the exception. It is one login shared by every visitor,
 * so its stored theme is whatever the last of them picked, not a preference of
 * the person looking at it now. Adopting it would repaint their screen and
 * overwrite the choice cached on their device. A demo session keeps the theme
 * the visitor arrived with instead, on every load, since `/auth/me` reports
 * `isDemo` just as the demo sign-in does.
 */
export function useAccountTheme(): void {
  const { user } = useSession();
  const adoptAccountPreference = useThemeStore((state) => state.adoptAccountPreference);
  const { mutate: updatePreferences } = useUpdatePreferences();

  useEffect(() => {
    if (!user || user.isDemo) return;

    const local = useThemeStore.getState().preference;
    if (takePendingChoice() && local !== user.theme) {
      updatePreferences({ theme: local });
      return;
    }

    adoptAccountPreference(user.theme);
  }, [user, adoptAccountPreference, updatePreferences]);
}
