import type { Express } from 'express';
import request from 'supertest';
import { createApp } from '@/app';
import { REFRESH_COOKIE_NAME } from '@/utils/cookies';

export const AUTH_BASE = '/api/v1/auth';

let sequence = 0;

export interface RegisterPayload {
  name: string;
  email: string;
  password: string;
  acceptTerms: true;
  timezone?: string;
}

/** Unique-by-default registration body so parallel cases never collide on email. */
export function buildRegisterPayload(overrides: Partial<RegisterPayload> = {}): RegisterPayload {
  sequence += 1;

  return {
    name: 'Ada Lovelace',
    email: `user-${String(sequence)}-${String(Date.now())}@example.com`,
    password: 'Str0ngPassw0rd',
    acceptTerms: true,
    ...overrides,
  };
}

/** Returns the `name=value` pair, ready to hand back via `.set('Cookie', ...)`. */
export function extractRefreshCookie(response: request.Response): string {
  const header: unknown = response.headers['set-cookie'];
  const cookies = (Array.isArray(header) ? header : [header]).filter(
    (value): value is string => typeof value === 'string',
  );
  const match = cookies.find((value) => value.startsWith(`${REFRESH_COOKIE_NAME}=`));

  if (!match) {
    throw new Error('Response did not set a refresh cookie');
  }

  return match.split(';')[0];
}

/** The raw token inside a `name=value` cookie pair. */
export function cookieValue(cookie: string): string {
  return cookie.slice(cookie.indexOf('=') + 1);
}

export interface RegisteredUser {
  app: Express;
  payload: RegisterPayload;
  userId: string;
  accessToken: string;
  refreshCookie: string;
}

export async function registerUser(
  app: Express,
  overrides: Partial<RegisterPayload> = {},
): Promise<RegisteredUser> {
  const payload = buildRegisterPayload(overrides);
  const response = await request(app).post(`${AUTH_BASE}/register`).send(payload);

  if (response.status !== 201) {
    throw new Error(`Registration failed: ${String(response.status)} ${response.text}`);
  }

  return {
    app,
    payload,
    userId: response.body.data.user.id,
    accessToken: response.body.data.accessToken,
    refreshCookie: extractRefreshCookie(response),
  };
}

export function buildTestApp(): Express {
  return createApp();
}
