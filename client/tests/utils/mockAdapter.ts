import {
  AxiosError,
  AxiosHeaders,
  type AxiosAdapter,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios';
import { apiClient } from '@/api/client';
import { authClient } from '@/api/http';

export interface RecordedRequest {
  method: string;
  url: string;
  /** The header the request actually carried, which is how a stale token is spotted. */
  authorization: string | null;
  data: unknown;
}

export interface MockReply {
  status: number;
  data?: unknown;
}

export type Responder = (request: RecordedRequest) => MockReply | Promise<MockReply>;

export interface MockApi {
  calls: RecordedRequest[];
  callsTo: (method: string, url: string) => RecordedRequest[];
}

function parseBody(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

/**
 * A hand-rolled axios adapter, installed on both API instances.
 *
 * Mocking at the adapter boundary rather than with MSW is deliberate: the subject
 * under test *is* the interceptor chain, and swapping the adapter exercises all of
 * it — request interceptor, transport, response interceptor, replay — while giving
 * an exact, ordered record of every call. MSW would intercept below that, at XHR,
 * to prove the same assertions with more setup.
 */
export function installMockApi(routes: Record<string, Responder>): MockApi {
  const calls: RecordedRequest[] = [];

  const adapter: AxiosAdapter = async (config: InternalAxiosRequestConfig) => {
    const method = (config.method ?? 'get').toUpperCase();
    const url = config.url ?? '';
    const header = config.headers.get('Authorization');

    const request: RecordedRequest = {
      method,
      url,
      authorization: typeof header === 'string' ? header : null,
      data: parseBody(config.data),
    };
    calls.push(request);

    const responder = routes[`${method} ${url}`];
    if (!responder) throw new Error(`No mock route registered for ${method} ${url}`);

    const reply = await responder(request);
    const response: AxiosResponse = {
      data: reply.data ?? null,
      status: reply.status,
      statusText: String(reply.status),
      headers: new AxiosHeaders(),
      config,
    };

    if (reply.status >= 200 && reply.status < 300) return response;

    throw new AxiosError(
      `Request failed with status code ${String(reply.status)}`,
      AxiosError.ERR_BAD_REQUEST,
      config,
      null,
      response,
    );
  };

  apiClient.defaults.adapter = adapter;
  authClient.defaults.adapter = adapter;

  return {
    calls,
    callsTo: (method, url) =>
      calls.filter((call) => call.method === method.toUpperCase() && call.url === url),
  };
}

/** A promise plus its resolver, used to hold a response open across other work. */
export function createGate(): { wait: Promise<void>; open: () => void } {
  let open = (): void => undefined;
  const wait = new Promise<void>((resolve) => {
    open = resolve;
  });

  return { wait, open };
}
