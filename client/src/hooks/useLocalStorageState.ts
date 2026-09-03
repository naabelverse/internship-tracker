import { useCallback, useState } from 'react';
import { logger } from '@/lib/logger';

/**
 * State mirrored into localStorage, for preferences that belong to the device
 * rather than the account — currently the table's column visibility.
 *
 * Every access is guarded: storage throws outright in some private browsing
 * modes, and a preference is never worth taking the page down for.
 */
export function useLocalStorageState<T>(
  key: string,
  fallback: T,
  isValid: (value: unknown) => value is T,
): [T, (value: T) => void] {
  const [state, setState] = useState<T>(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw === null) return fallback;

      const parsed: unknown = JSON.parse(raw);
      return isValid(parsed) ? parsed : fallback;
    } catch {
      return fallback;
    }
  });

  const store = useCallback(
    (value: T) => {
      setState(value);

      try {
        window.localStorage.setItem(key, JSON.stringify(value));
      } catch (error) {
        logger.warn('Could not persist a preference', { key, error });
      }
    },
    [key],
  );

  return [state, store];
}
