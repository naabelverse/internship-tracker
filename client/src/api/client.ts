import {
  type AxiosError,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
  isAxiosError,
} from 'axios';
import { createHttpClient } from '@/api/http';
import { ensureFreshToken } from '@/api/refresh';
import { browserNavigation } from '@/lib/redirect';
import { paths } from '@/routes/paths';
import { getAccessToken } from '@/store/authStore';

/** The instance every authenticated call goes through. */
export const apiClient = createHttpClient();

function applyBearer(config: InternalAxiosRequestConfig, token: string | null): void {
  if (token === null) {
    config.headers.delete('Authorization');
    return;
  }

  config.headers.set('Authorization', `Bearer ${token}`);
}

/** The token a request was actually sent with, so a stale one can be detected. */
function readBearer(config: InternalAxiosRequestConfig): string | null {
  const header = config.headers.get('Authorization');
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return null;

  return header.slice('Bearer '.length);
}

apiClient.interceptors.request.use((config) => {
  applyBearer(config, getAccessToken());
  return config;
});

function replay(config: InternalAxiosRequestConfig, token: string): Promise<AxiosResponse> {
  config.isRetryAfterRefresh = true;
  applyBearer(config, token);

  return apiClient.request(config);
}

/**
 * On a 401, obtain a fresh access token and replay the request exactly once.
 *
 * Three conditions keep "exactly once" true under concurrency:
 *  1. `isRetryAfterRefresh` — a request already replayed after a refresh never
 *     triggers another one, so a genuinely revoked session fails instead of looping.
 *  2. The token comparison — a 401 that lands just after another request's refresh
 *     finished is replayed with the new token directly, without a second refresh.
 *     Without this, a request that failed against the old token but reported it
 *     late would start a redundant refresh even though a valid token was in hand.
 *  3. `ensureFreshToken` itself, which collapses every concurrent caller onto one
 *     `POST /auth/refresh`.
 */
async function handleUnauthorized(error: AxiosError): Promise<AxiosResponse> {
  const config = error.config;

  if (error.response?.status !== 401 || !config || config.isRetryAfterRefresh === true) {
    throw error;
  }

  const currentToken = getAccessToken();
  if (currentToken !== null && currentToken !== readBearer(config)) {
    return replay(config, currentToken);
  }

  let token: string;
  try {
    token = await ensureFreshToken();
  } catch {
    // The refresh token is gone or reused. In-memory state is already cleared by
    // the refresh coordinator; leave the SPA entirely so no stale cache survives.
    // Skipping the redirect when already on /login is what stops a reload loop.
    if (window.location.pathname !== paths.login) {
      browserNavigation.hardRedirect(paths.login);
    }
    throw error;
  }

  return replay(config, token);
}

apiClient.interceptors.response.use(
  (response) => response,
  (error: unknown) => (isAxiosError(error) ? handleUnauthorized(error) : Promise.reject(error)),
);
