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
