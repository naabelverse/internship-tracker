import { request, type APIRequestContext } from '@playwright/test';
import { clientAddress } from './network';

export const API_URL = process.env.E2E_API_URL ?? 'http://localhost:5001';

/**
 * Every request below is written against this prefix explicitly rather than
 * folded into `baseURL`. Playwright resolves a request path with `new URL()`
 * semantics, so a path starting with `/` discards the base's path entirely and
 * `/auth/register` would quietly become `http://host/auth/register` — a 404 that
 * looks like a missing route rather than a missing prefix.
 */
const V1 = '/api/v1';

export interface TestAccount {
  name: string;
  email: string;
  password: string;
  timezone: string;
}

/**
 * A fresh account, unique per call.
 *
 * The suite runs repeatedly against the same long-lived database, so a fixed
 * address would collide with the previous run's account on the second pass and
 * the failure would look like a registration bug. `@example.com` is reserved by
 * RFC 2606 and can never reach a real inbox.
 */
export function newAccount(prefix: string): TestAccount {
  const unique = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  return {
    name: `E2E ${prefix}`,
    email: `e2e-${prefix}-${unique}@example.com`,
    password: 'E2ePassw0rd!',
    timezone: 'UTC',
  };
}

/**
 * An API client that arrives from the same synthetic address as the browser in
 * the same spec file, so setup requests and the browser's own requests are
 * counted against one rate-limit bucket rather than two.
 */
export async function apiFor(slot: number): Promise<APIRequestContext> {
  return request.newContext({
    baseURL: API_URL,
    extraHTTPHeaders: { 'X-Forwarded-For': clientAddress(slot) },
  });
}

interface Session {
  accessToken: string;
}

/** Registers an account and returns the session registration hands back. */
export async function registerAccount(
  api: APIRequestContext,
  account: TestAccount,
): Promise<Session> {
  const response = await api.post(`${V1}/auth/register`, {
    data: {
      name: account.name,
      email: account.email,
      password: account.password,
      timezone: account.timezone,
      acceptTerms: true,
    },
  });

  if (!response.ok()) {
    throw new Error(`Register failed (${String(response.status())}): ${await response.text()}`);
  }

  const body = (await response.json()) as { data: Session };
  return body.data;
}

export async function loginAccount(api: APIRequestContext, account: TestAccount): Promise<Session> {
  const response = await api.post(`${V1}/auth/login`, {
    data: { email: account.email, password: account.password },
  });

  if (!response.ok()) {
    throw new Error(`Login failed (${String(response.status())}): ${await response.text()}`);
  }

  const body = (await response.json()) as { data: Session };
  return body.data;
}

/**
 * Fills an empty account with the demo set through the dashboard's own "Load
 * demo data" endpoint: the same deterministic generator the demo account is
 * reset from, dated relative to now.
 */
export async function loadDemoData(api: APIRequestContext, accessToken: string): Promise<void> {
  const response = await api.post(`${V1}/applications/demo-data`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok()) {
    throw new Error(`Demo data failed (${String(response.status())}): ${await response.text()}`);
  }
}

/** Sets the account's weekly goal through the profile endpoint Settings uses. */
export async function setWeeklyGoal(
  api: APIRequestContext,
  accessToken: string,
  weeklyGoal: number,
): Promise<void> {
  const response = await api.patch(`${V1}/auth/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    data: { weeklyGoal },
  });

  if (!response.ok()) {
    throw new Error(`Goal update failed (${String(response.status())}): ${await response.text()}`);
  }
}

export interface SeedApplication {
  company: string;
  role: string;
  status?: string;
  source?: string;
  sourceOther?: string;
  priority?: string;
  tags?: string[];
}

/** Creates one application through the real endpoint, as the given session. */
export async function createApplication(
  api: APIRequestContext,
  accessToken: string,
  application: SeedApplication,
): Promise<{ id: string }> {
  const response = await api.post(`${V1}/applications`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    data: { status: 'saved', priority: 'medium', ...application },
  });

  if (!response.ok()) {
    throw new Error(`Create failed (${String(response.status())}): ${await response.text()}`);
  }

  const body = (await response.json()) as { data: { application: { id: string } } };
  return body.data.application;
}
