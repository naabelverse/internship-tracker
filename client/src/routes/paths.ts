/** Every route path in one place, so links and redirects cannot drift apart. */
export const paths = {
  /**
   * The public landing page. Phase 13 moved the dashboard off `/` to make room
   * for it: a signed-in visitor is redirected from here to `dashboard`, which is
   * a redirect rather than two pages competing over one path.
   */
  landing: '/',
  dashboard: '/dashboard',
  applications: '/applications',
  board: '/applications/board',
  calendar: '/applications/calendar',
  applicationDetail: (id: string): string => `/applications/${id}`,
  settings: '/settings',
  login: '/login',
  register: '/register',
  forgotPassword: '/forgot-password',
  resetPassword: '/reset-password',
  verifyEmail: '/verify-email',
  /** Where a closed account lands: sign-in will not work from here. */
  accountClosed: '/account-closed',
  terms: '/terms',
  privacy: '/privacy',
} as const;

/** The public routes a crawler may index. `sitemap.xml` is generated from this. */
export const INDEXABLE_PATHS: readonly string[] = [
  paths.landing,
  paths.login,
  paths.register,
  paths.terms,
  paths.privacy,
];
