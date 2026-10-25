import { useEffect } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

/**
 * Starts every newly opened page at the top.
 *
 * `BrowserRouter` has no scroll restoration (`<ScrollRestoration>` needs a data
 * router), so a link clicked at the foot of one page opened the next at the same
 * offset - the footer's Terms and Privacy links landed on the bottom of the
 * document. Keyed on the pathname alone, so a filter or search change that only
 * rewrites the query string does not jump the list; back and forward (`POP`) are
 * left to the browser, and a `#hash` target keeps its own anchor.
 */
export function useScrollToTopOnNavigate(): void {
  const { pathname, hash } = useLocation();
  const navigationType = useNavigationType();

  useEffect(() => {
    if (navigationType === 'POP' || hash) return;
    window.scrollTo(0, 0);
  }, [pathname, hash, navigationType]);
}
