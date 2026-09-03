import type { ApiErrorBody, ApiSuccessBody } from '@/types/api';
import type { AuthSession, User } from '@/types/user';

let sequence = 0;

/** Distinct ids and emails per call, so two users in one test cannot collide. */
export function makeUser(overrides: Partial<User> = {}): User {
  sequence += 1;

  return {
    id: `user-${String(sequence)}`,
    name: 'Ada Lovelace',
    email: `ada-${String(sequence)}@example.test`,
    targetRoles: ['Backend Intern'],
    weeklyGoal: 5,
    theme: 'system',
    timezone: 'Asia/Kuala_Lumpur',
    emailRemindersEnabled: true,
    emailVerified: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export function makeSession(overrides: Partial<AuthSession> = {}): AuthSession {
  return { user: makeUser(), accessToken: 'access-token-1', ...overrides };
}

export function successBody<T>(data: T, message?: string): ApiSuccessBody<T> {
  return message === undefined ? { success: true, data } : { success: true, data, message };
}

export function errorBody(
  message: string,
  code: string,
  errors?: Record<string, string[]>,
): ApiErrorBody {
  return errors === undefined
    ? { success: false, message, code }
    : { success: false, message, code, errors };
}
