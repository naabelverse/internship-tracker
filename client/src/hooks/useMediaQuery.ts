import { useEffect, useState } from 'react';

/**
 * Tracks a media query. The table uses it to render stacked cards instead of a
 * grid below `md`, which SPEC section 6 asks for at 375 px — a real swap rather
 * than a table that scrolls sideways.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window.matchMedia !== 'function') return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;

    const list = window.matchMedia(query);
    const onChange = (event: MediaQueryListEvent): void => {
      setMatches(event.matches);
    };

    setMatches(list.matches);
    list.addEventListener('change', onChange);

    return () => {
      list.removeEventListener('change', onChange);
    };
  }, [query]);

  return matches;
}
