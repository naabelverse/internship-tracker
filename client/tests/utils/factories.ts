import type { ApiErrorBody, ApiSuccessBody, PaginationMeta } from '@/types/api';
import type { Application, Attachment, Interview } from '@/types/application';
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

export function makeInterview(overrides: Partial<Interview> = {}): Interview {
  sequence += 1;

  return {
    id: `interview-${String(sequence)}`,
    type: 'technical',
    scheduledAt: '2026-02-10T09:00:00.000Z',
    mode: 'video',
    outcome: 'pending',
    ...overrides,
  };
}

export function makeAttachment(overrides: Partial<Attachment> = {}): Attachment {
  sequence += 1;

  return {
    id: `attachment-${String(sequence)}`,
    originalName: 'resume.pdf',
    mimeType: 'application/pdf',
    size: 120_000,
    url: 'https://files.example.test/resume.pdf',
    uploadedAt: '2026-01-20T00:00:00.000Z',
    ...overrides,
  };
}

export function makeApplication(overrides: Partial<Application> = {}): Application {
  sequence += 1;

  return {
    id: `application-${String(sequence)}`,
    company: `Company ${String(sequence)}`,
    role: 'Backend Intern',
    employmentType: 'internship',
    status: 'applied',
    priority: 'medium',
    source: 'linkedin',
    tags: ['backend'],
    interviews: [],
    statusHistory: [
      { from: null, to: 'saved', changedAt: '2026-01-01T00:00:00.000Z' },
      { from: 'saved', to: 'applied', changedAt: '2026-01-05T00:00:00.000Z' },
    ],
    archived: false,
    attachments: [],
    version: 3,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-05T00:00:00.000Z',
    ...overrides,
  };
}

/** The list envelope the API returns, with `meta` derived from the rows given. */
export function makeListResponse(
  applications: Application[],
  meta: Partial<PaginationMeta> = {},
): ApiSuccessBody<{ applications: Application[] }> {
  const limit = meta.limit ?? 20;
  const total = meta.total ?? applications.length;

  return {
    success: true,
    data: { applications },
    meta: {
      total,
      page: meta.page ?? 1,
      limit,
      totalPages: meta.totalPages ?? Math.max(Math.ceil(total / limit), 1),
    },
  };
}
