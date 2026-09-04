import { apiClient } from '@/api/client';
import { authClient } from '@/api/http';
import type { ApiSuccessBody } from '@/types/api';
import type { AuthSession, ThemePreference, User } from '@/types/user';

export interface RegisterPayload {
  name: string;
  email: string;
  password: string;
  timezone: string;
  acceptTerms: true;
}

export interface LoginPayload {
  email: string;
  password: string;
}

/**
 * Register and login go through `authClient`: they establish the session, so a
 * 401 from them is a credentials answer and must never start a silent refresh.
 */
export async function register(payload: RegisterPayload): Promise<AuthSession> {
  const { data } = await authClient.post<ApiSuccessBody<AuthSession>>('/auth/register', payload);
  return data.data;
}

export async function login(payload: LoginPayload): Promise<AuthSession> {
  const { data } = await authClient.post<ApiSuccessBody<AuthSession>>('/auth/login', payload);
  return data.data;
}

/** Revokes the refresh token and clears the cookie. Errors are the caller's to handle. */
export async function logout(): Promise<void> {
  await authClient.post('/auth/logout');
}

/** The subset of the account SPEC section 6 lets Settings edit. */
export interface UpdateMePayload {
  name?: string;
  avatarUrl?: string;
  university?: string;
  gradYear?: number;
  targetRoles?: string[];
  weeklyGoal?: number;
  theme?: ThemePreference;
  timezone?: string;
  emailRemindersEnabled?: boolean;
  weeklySummaryEnabled?: boolean;
  /** Parked as `pendingEmail` by the server until it is confirmed. */
  email?: string;
}

export interface ChangePasswordPayload {
  currentPassword: string;
  newPassword: string;
}

/** Patches the account and returns the saved user, which is the new source of truth. */
export async function updateMe(payload: UpdateMePayload): Promise<User> {
  const { data } = await apiClient.patch<ApiSuccessBody<{ user: User }>>('/auth/me', payload);
  return data.data.user;
}

/**
 * Changes the password. Per SPEC section 5 the server revokes every other
 * refresh token, so this session survives and all other devices are signed out.
 */
export async function changePassword(payload: ChangePasswordPayload): Promise<void> {
  await apiClient.patch('/auth/me/password', payload);
}

/** Reads the signed-in user; goes through the interceptor so it can survive a 401. */
export async function fetchMe(): Promise<User> {
  const { data } = await apiClient.get<ApiSuccessBody<{ user: User }>>('/auth/me');
  return data.data.user;
}

export interface ActiveSession {
  id: string;
  userAgent?: string;
  ip?: string;
  lastUsedAt?: string;
  createdAt: string;
  expiresAt: string;
  /** True for the device making the request, decided server-side by token hash. */
  current: boolean;
}

/**
 * The account lifecycle calls, per SPEC section 5.
 *
 * Verification and reset go through `authClient`, not `apiClient`: they carry a
 * token from an email rather than a session, so a 401 or 400 from them is an
 * answer about that token and must never start a silent refresh.
 */
export async function verifyEmail(token: string): Promise<User> {
  const { data } = await authClient.post<ApiSuccessBody<{ user: User }>>('/auth/verify-email', {
    token,
  });
  return data.data.user;
}

export async function resendVerification(): Promise<void> {
  await apiClient.post('/auth/resend-verification');
}

/**
 * Asks for a reset link. The server answers identically whether or not the
 * address has an account, and this resolves the same way for both, so nothing
 * downstream can tell them apart either.
 */
export async function forgotPassword(email: string): Promise<void> {
  await authClient.post('/auth/forgot-password', { email });
}

export async function resetPassword(token: string, password: string): Promise<void> {
  await authClient.post('/auth/reset-password', { token, password });
}

export async function fetchSessions(): Promise<ActiveSession[]> {
  const { data } =
    await apiClient.get<ApiSuccessBody<{ sessions: ActiveSession[] }>>('/auth/sessions');
  return data.data.sessions;
}

export async function revokeSession(id: string): Promise<void> {
  await apiClient.delete(`/auth/sessions/${id}`);
}

/** Revokes every refresh token, including this one. */
export async function logoutEverywhere(): Promise<void> {
  await apiClient.post('/auth/logout-all');
}

/** Soft deletes the account. The password is re-checked server-side. */
export async function deleteAccount(password: string): Promise<void> {
  await apiClient.delete('/auth/me', { data: { password } });
}
