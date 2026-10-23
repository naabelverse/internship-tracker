import { env } from '@/config/env';
import type { MailTransport, OutgoingMessage } from '@/mail/transport';

/**
 * The same transport contract as SMTP, over HTTP instead of port 587.
 *
 * This exists because outbound SMTP is not always available. Railway blocks it
 * on every port a provider offers — 465, 2465, 587 and 2587 all time out — which
 * is a common anti-abuse posture on shared PaaS networks rather than a fault in
 * the provider or in the queue. HTTPS on 443 is not subject to that block, so
 * the message goes out over Resend's REST API instead.
 *
 * Nothing above the transport seam changes. This implements `MailTransport`,
 * which means the queue's retry and backoff, the request-isolation guarantee and
 * the preference gate all apply here exactly as they do to SMTP, and the six
 * templates render through the same code either way. SMTP remains the default
 * and is untouched: this is an additional mode, chosen by configuration, not a
 * replacement.
 */

/** Resend's send endpoint. Overridable so tests never depend on the network. */
export const RESEND_ENDPOINT = 'https://api.resend.com/emails';

/**
 * The subset of `fetch` this module uses, so a test can supply a double without
 * standing up a server or reaching for a global.
 */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface ResendTransportOptions {
  apiKey?: string;
  endpoint?: string;
  fetchImpl?: FetchLike;
}

/**
 * 429 is a rate or quota limit and 5xx is Resend's own problem; both are worth
 * another attempt. 401, 403 and 422 are a wrong key, an unverified domain or a
 * malformed message, none of which a retry can fix.
 *
 * This classification is advisory. The queue retries every rejection alike, the
 * same as it does for a bad SMTP password, so this exists to make the log line
 * say which kind of failure it was rather than to change control flow.
 */
export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

/**
 * A failed send, carrying enough to tell a transient problem from a permanent
 * one in the logs.
 *
 * Note what it does not carry: the message body. These bodies hold verification
 * and reset tokens, and SPEC section 14 forbids logging them.
 */
export class ResendSendError extends Error {
  readonly status: number;
  readonly code: string;
  /** Whether trying the same message again could plausibly succeed. */
  readonly retryable: boolean;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ResendSendError';
    this.status = status;
    this.code = code;
    this.retryable = isRetryableStatus(status);
  }
}

/** Resend's error body, as far as this module depends on it. */
interface ResendErrorBody {
  name?: unknown;
  message?: unknown;
}

/**
 * Reads Resend's error body without trusting it. A gateway between us and them
 * can return HTML or nothing at all on a 502, so a parse failure has to degrade
 * to the status code rather than throw a second error over the first.
 */
async function describeFailure(response: Response): Promise<ResendSendError> {
  let code = 'unknown_error';
  let detail = response.statusText || 'no detail';

  try {
    const body: unknown = await response.json();

    if (typeof body === 'object' && body !== null) {
      const { name, message } = body as ResendErrorBody;
      if (typeof name === 'string' && name.length > 0) code = name;
      if (typeof message === 'string' && message.length > 0) detail = message;
    }
  } catch {
    // Left as the status text: a body that is not JSON tells us nothing more.
  }

  return new ResendSendError(
    response.status,
    code,
    `Resend rejected the message: ${String(response.status)} ${code} — ${detail}`,
  );
}

/**
 * Builds the request body.
 *
 * `to` is an array because Resend accepts one or many and an array is the shape
 * that does not change meaning when a second recipient is added. `text` and
 * `html` are both sent: the queue always renders both alternatives, and dropping
 * one would make this transport deliver a different message than SMTP does.
 */
function buildPayload(message: OutgoingMessage, from: string): Record<string, unknown> {
  return {
    from,
    to: [message.to],
    subject: message.subject,
    html: message.html,
    text: message.text,
    // `List-Unsubscribe` and friends ride here, so optional mail stays
    // unsubscribable through this path exactly as it is through SMTP.
    headers: message.headers,
    ...(message.replyTo ? { reply_to: message.replyTo } : {}),
  };
}

/**
 * Sends one message, rejecting on any failure so the queue can own the retry.
 *
 * @throws {ResendSendError} when Resend answers with a non-2xx status.
 */
export async function sendViaResend(
  message: OutgoingMessage,
  options: { apiKey: string; endpoint: string; fetchImpl: FetchLike },
  from: string,
): Promise<void> {
  const response = await options.fetchImpl(options.endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(buildPayload(message, from)),
  });

  if (!response.ok) throw await describeFailure(response);
}

/**
 * The transport itself.
 *
 * The API key is read once here rather than per send, and its absence is a
 * programming error by this point: the env loader refuses to boot in this mode
 * without one, so reaching this line with nothing set means that check was
 * removed.
 */
export function createResendTransport(options: ResendTransportOptions = {}): MailTransport {
  const apiKey = options.apiKey ?? env.RESEND_API_KEY;

  if (!apiKey) {
    throw new Error('RESEND_API_KEY is required when MAIL_TRANSPORT is resend-api');
  }

  const endpoint = options.endpoint ?? RESEND_ENDPOINT;
  const fetchImpl: FetchLike = options.fetchImpl ?? ((url, init) => fetch(url, init));

  return {
    mode: 'resend-api',
    async send(message: OutgoingMessage): Promise<void> {
      await sendViaResend(message, { apiKey, endpoint, fetchImpl }, env.MAIL_FROM);
    },
  };
}
