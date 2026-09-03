import { useEffect, useState } from 'react';

/**
 * Trails `value` by `delayMs`, resetting the timer on every change. Used for the
 * 300 ms search debounce and the 1 s notes autosave.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(value);
    }, delayMs);

    return () => {
      clearTimeout(timer);
    };
  }, [value, delayMs]);

  return debounced;
}
