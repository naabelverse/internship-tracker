import axios, { type AxiosInstance } from 'axios';
import { clientEnv } from '@/lib/env';

declare module 'axios' {
  interface AxiosRequestConfig {
    /**
     * Set by the response interceptor on a request it has already replayed once
     * after a silent refresh. A second 401 on the same request must surface
     * rather than trigger another refresh, which is what would otherwise loop.
     */
    isRetryAfterRefresh?: boolean;
  }
}

/** 15 s: long enough for a cold serverless API, short enough to fail visibly. */
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * `withCredentials` is mandatory rather than a convenience: the refresh token is
 * an httpOnly cookie, so a cross-origin request without it can never rotate.
 */
export function createHttpClient(): AxiosInstance {
  return axios.create({
    baseURL: clientEnv.apiBaseUrl,
    withCredentials: true,
    timeout: REQUEST_TIMEOUT_MS,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Transport for the endpoints that create or destroy a session: register, login,
 * refresh and logout. It carries no interceptors on purpose — a 401 from any of
 * them is the answer, not a signal to go and refresh, and routing the refresh
 * call itself through the refreshing interceptor would recurse.
 */
export const authClient = createHttpClient();
