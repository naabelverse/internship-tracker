import { env } from '@/config/env';

/**
 * The client routes an email is allowed to link into.
 *
 * The authoritative table is `client/src/routes/paths.ts`; these are the three
 * entries the server needs, mirrored here because the workspaces do not share
 * code. A test asserts the mirror still matches, so a route rename on the client
 * cannot quietly turn every email button into a 404.
 */
export const MAIL_LINK_PATHS = {
  dashboard: '/',
  board: '/applications/board',
  settings: '/settings',
} as const;

function appUrl(path: string): string {
  return path === '/' ? env.APP_URL : `${env.APP_URL}${path}`;
}

/** Where a signed-in user manages every email setting at once. */
export function preferencesUrl(): string {
  return appUrl(MAIL_LINK_PATHS.settings);
}

export function boardUrl(): string {
  return appUrl(MAIL_LINK_PATHS.board);
}

export function dashboardUrl(): string {
  return appUrl(MAIL_LINK_PATHS.dashboard);
}
