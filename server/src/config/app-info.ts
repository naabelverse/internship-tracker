/**
 * Application identity. Kept in sync with `server/package.json` by a test so the
 * two cannot drift; imported wherever a name or version is reported.
 */
export const APP_NAME = 'internship-tracker-api';
export const APP_VERSION = '1.0.0';

/**
 * The product name as a person reads it — the sidebar wordmark, the browser
 * title, and the masthead on every email. `APP_NAME` is the service identifier
 * that goes in logs and the OpenAPI server entry; this is the human one.
 */
export const APP_PRODUCT_NAME = 'Internship Tracker';

/**
 * The email masthead's alt text. The logo itself is a PNG served by the client;
 * a mail client that blocks remote images shows these two letters on the same
 * dark cell instead of a broken image.
 */
export const APP_LOGO_MARK = 'IT';

/**
 * Where in-app feedback is mailed. The same public project alias as the client's
 * `CONTACT_EMAIL`, chosen by the maintainer (see DECISIONS.md).
 */
export const FEEDBACK_INBOX = 'naabel.workspace@gmail.com';
