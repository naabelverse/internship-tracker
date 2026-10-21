/**
 * Copy and links that appear in more than one place on the public surface — the
 * footer, the legal pages, the SEO tags and the generated brand assets.
 *
 * `CONTACT_EMAIL` is the `{{CONTACT_EMAIL}}` placeholder SPEC section 12 asks
 * for, kept here as well as in the markdown so the footer's mailto and the legal
 * text are filled in from one place rather than two.
 */
import { version } from '../../package.json';

export const CONTACT_EMAIL = 'naabel.workspace@gmail.com';

export const AUTHOR_URL = 'https://www.linkedin.com/in/naabel1910';

export const REPO_URL = 'https://github.com/naabelverse/internship-tracker';

/** Read from `client/package.json`; Vite inlines only this field, not the whole file. */
export const APP_VERSION = version;

export const APP_TAGLINE =
  'Track every internship application in one place, and never miss a deadline again.';

export const APP_DESCRIPTION =
  'A free, open-source tracker for internship applications: a Kanban board, a deadline calendar, email reminders and real statistics about your search. Your data stays yours.';
