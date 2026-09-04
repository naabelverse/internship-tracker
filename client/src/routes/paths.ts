/** Every route path in one place, so links and redirects cannot drift apart. */
export const paths = {
  dashboard: '/',
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
} as const;
