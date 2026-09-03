/**
 * Full-page navigation, isolated behind an object so tests can spy on it without
 * stubbing `window.location`. Used only for the hard logout after a refresh
 * fails, where discarding all in-memory state is the point.
 */
export const browserNavigation = {
  hardRedirect(url: string): void {
    window.location.assign(url);
  },
};
