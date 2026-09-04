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
  /** Opt-in, so this stays false until the user asks for it in Settings. */
  weeklySummaryEnabled: boolean;
  emailVerified: boolean;
  /**
   * An address the user has asked to move to, held until they confirm it. The
   * server keeps the current address live for signing in until then.
   */
  pendingEmail?: string;
  lastLoginAt?: string;
  createdAt: string;
  updatedAt: string;
}

/** Register and login both return the user plus a fresh in-memory access token. */
export interface AuthSession {
  user: User;
  accessToken: string;
}
