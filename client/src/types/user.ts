export const THEME_PREFERENCES = ['light', 'dark', 'system'] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];

/** The user shape the API returns from `/auth/me`, after `toJSON` strips secrets. */
export interface User {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
  university?: string;
  gradYear?: number;
  targetRoles: string[];
  weeklyGoal: number;
  theme: ThemePreference;
  timezone: string;
  emailRemindersEnabled: boolean;
  emailVerified: boolean;
  lastLoginAt?: string;
  createdAt: string;
  updatedAt: string;
}

/** Register and login both return the user plus a fresh in-memory access token. */
export interface AuthSession {
  user: User;
  accessToken: string;
}
