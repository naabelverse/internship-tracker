import { parseEnv } from '@/config/env';
import { MailQueue } from '@/mail/queue';
import {
  type FetchLike,
  RESEND_ENDPOINT,
  type ResendSendError,
  createResendTransport,
  isRetryableStatus,
} from '@/mail/resendTransport';
import { renderMail } from '@/mail/templates';
import type { OutgoingMessage } from '@/mail/transport';
import { MAIL_CATEGORY, MAIL_KINDS, type MailKind, type MailMessage } from '@/mail/types';

/**
 * The HTTP transport, which exists because Railway blocks outbound SMTP on every
 * port a provider offers.
 *
 * The point of these cases is that this is the *same* transport contract rather
 * than a parallel system: the real queue drives it with the real retry schedule,
 * the real templates render through it, and a failure still never reaches the
 * request that triggered it. Nothing here doubles the queue or the templates —
 * only the network, which is the one thing a test must not reach.
 */

const BASE_ENV = {
  MONGO_URI: 'mongodb://127.0.0.1:27017/it',
  JWT_ACCESS_SECRET: 'a',
  JWT_REFRESH_SECRET: 'b',
};

const API_KEY = 're_test_key_not_a_real_credential';

function message(overrides: Partial<OutgoingMessage> = {}): OutgoingMessage {
  return {
    to: 'ada@example.com',
    kind: 'verify_email',
    subject: 'Verify your email',
    html: '<p>hello</p>',
    text: 'hello',
    headers: {},
    ...overrides,
  };
}

interface FetchStub {
  impl: FetchLike;
  calls: RequestInit[];
  urls: string[];
}

/**
 * A `fetch` double. The last queued response repeats, so a test that wants
 * "fails every time" supplies one failure rather than three.
 */
function stubFetch(responses: Response[]): FetchStub {
  const calls: RequestInit[] = [];
  const urls: string[] = [];
  let index = 0;

  const impl: FetchLike = (url, init) => {
    urls.push(url);
    calls.push(init);
    const response = responses[Math.min(index, responses.length - 1)];
    index += 1;

    return Promise.resolve(response.clone());
  };

  return { impl, calls, urls };
}

function ok(): Response {
  return new Response(JSON.stringify({ id: '49a3999c-0ce1-4ea6-ab68-afcd6dc2e794' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function failure(status: number, name: string, detail: string): Response {
  return new Response(JSON.stringify({ name, message: detail, statusCode: status }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function bodyOf(stub: FetchStub): Record<string, unknown> {
  return JSON.parse(String(stub.calls[0].body)) as Record<string, unknown>;
}

describe('the environment loader gates this transport on its credential', () => {
  it('refuses to boot in resend-api mode with no key, as smtp does with no host', () => {
    expect(() => parseEnv({ ...BASE_ENV, MAIL_TRANSPORT: 'resend-api' })).toThrow(/RESEND_API_KEY/);
  });

  it('accepts resend-api once the key is present', () => {
    const parsed = parseEnv({
      ...BASE_ENV,
      MAIL_TRANSPORT: 'resend-api',
      RESEND_API_KEY: API_KEY,
    });

    expect(parsed.MAIL_TRANSPORT).toBe('resend-api');
    expect(parsed.RESEND_API_KEY).toBe(API_KEY);
  });

  /* The existing modes are untouched: this is an addition, not a migration. */
  it('still accepts the smtp and console modes unchanged', () => {
    expect(parseEnv({ ...BASE_ENV, MAIL_TRANSPORT: 'console' }).MAIL_TRANSPORT).toBe('console');
    expect(
      parseEnv({ ...BASE_ENV, MAIL_TRANSPORT: 'smtp', SMTP_HOST: 'smtp.example.com' })
        .MAIL_TRANSPORT,
    ).toBe('smtp');
  });

  it('does not demand a Resend key from a transport that does not use one', () => {
    expect(() => parseEnv({ ...BASE_ENV, MAIL_TRANSPORT: 'console' })).not.toThrow();
  });
});

describe('a successful send', () => {
  it('posts to Resend with bearer auth and a JSON content type', async () => {
    const stub = stubFetch([ok()]);

    await createResendTransport({ apiKey: API_KEY, fetchImpl: stub.impl }).send(message());

    const headers = stub.calls[0].headers as Record<string, string>;
    expect(stub.urls[0]).toBe(RESEND_ENDPOINT);
    expect(stub.calls[0].method).toBe('POST');
    expect(headers.Authorization).toBe(`Bearer ${API_KEY}`);
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('sends both bodies, so this transport delivers what SMTP would', async () => {
    const stub = stubFetch([ok()]);

    await createResendTransport({ apiKey: API_KEY, fetchImpl: stub.impl }).send(
      message({ html: '<p>body</p>', text: 'body' }),
    );

    expect(bodyOf(stub).html).toBe('<p>body</p>');
    expect(bodyOf(stub).text).toBe('body');
  });

  it('sends the recipient as an array, which is the shape Resend documents', async () => {
    const stub = stubFetch([ok()]);

    await createResendTransport({ apiKey: API_KEY, fetchImpl: stub.impl }).send(
      message({ to: 'grace@example.com' }),
    );

    expect(bodyOf(stub).to).toEqual(['grace@example.com']);
  });

  /* Optional mail must stay unsubscribable here, not only on the SMTP path. */
  it('forwards custom headers, so List-Unsubscribe survives the HTTP path', async () => {
    const stub = stubFetch([ok()]);
    const headers = { 'List-Unsubscribe': '<https://example.com/u/abc>' };

    await createResendTransport({ apiKey: API_KEY, fetchImpl: stub.impl }).send(
      message({ kind: 'reminder_digest', headers }),
    );

    expect(bodyOf(stub).headers).toEqual(headers);
  });

  it('reports its mode, which is what the boot log prints', () => {
    const transport = createResendTransport({ apiKey: API_KEY, fetchImpl: stubFetch([ok()]).impl });

    expect(transport.mode).toBe('resend-api');
  });

  it('refuses to be constructed without a key at all', () => {
    expect(() => createResendTransport({ apiKey: '', fetchImpl: stubFetch([ok()]).impl })).toThrow(
      /RESEND_API_KEY/,
    );
  });
});

describe('API error responses', () => {
  it('rejects on an invalid key, naming the code Resend returned', async () => {
    const stub = stubFetch([failure(401, 'missing_api_key', 'Invalid API key')]);

    await expect(
      createResendTransport({ apiKey: API_KEY, fetchImpl: stub.impl }).send(message()),
    ).rejects.toThrow(/missing_api_key/);
  });

  /* SPEC section 14: a credential must never reach a log line. */
  it('never puts the credential into the error a log would print', async () => {
    const stub = stubFetch([failure(401, 'missing_api_key', 'Invalid API key')]);

    const error = await createResendTransport({ apiKey: API_KEY, fetchImpl: stub.impl })
      .send(message())
      .catch((caught: unknown) => caught);

    expect(String(error)).not.toContain(API_KEY);
  });

  it('marks a rate limit retryable and a validation error not', async () => {
    const limited = stubFetch([failure(429, 'rate_limit_exceeded', 'Too many requests')]);
    const invalid = stubFetch([failure(422, 'missing_required_field', 'from is required')]);

    const limitError = (await createResendTransport({ apiKey: API_KEY, fetchImpl: limited.impl })
      .send(message())
      .catch((caught: unknown) => caught)) as ResendSendError;
    const invalidError = (await createResendTransport({ apiKey: API_KEY, fetchImpl: invalid.impl })
      .send(message())
      .catch((caught: unknown) => caught)) as ResendSendError;

    expect(limitError.retryable).toBe(true);
    expect(invalidError.retryable).toBe(false);
  });

  it('survives a non-JSON error body rather than throwing over the real failure', async () => {
    const stub = stubFetch([
      new Response('<html>502 Bad Gateway</html>', { status: 502, statusText: 'Bad Gateway' }),
    ]);

    await expect(
      createResendTransport({ apiKey: API_KEY, fetchImpl: stub.impl }).send(message()),
    ).rejects.toThrow(/502/);
  });

  it.each([
    [408, true],
    [429, true],
    [500, true],
    [503, true],
    [400, false],
    [401, false],
    [403, false],
    [422, false],
  ])('classifies %i as retryable=%s', (status, expected) => {
    expect(isRetryableStatus(status)).toBe(expected);
  });
});

describe('the queue drives this transport exactly as it drives SMTP', () => {
  const noDelay = (): Promise<void> => Promise.resolve();

  function queueOn(stub: FetchStub): MailQueue {
    return new MailQueue({
      transport: createResendTransport({ apiKey: API_KEY, fetchImpl: stub.impl }),
      delay: noDelay,
    });
  }

  it('retries a transient failure and reports the send as eventually sent', async () => {
    const queue = queueOn(stubFetch([failure(429, 'rate_limit_exceeded', 'slow down'), ok()]));

    queue.enqueue(message());
    await queue.idle();

    expect(queue.records()[0].outcome).toBe('sent');
    expect(queue.records()[0].attempts).toBe(2);
  });

  it('gives up after three attempts, recording the failure rather than throwing', async () => {
    const queue = queueOn(stubFetch([failure(500, 'application_error', 'boom')]));

    queue.enqueue(message());
    await queue.idle();

    expect(queue.records()[0].outcome).toBe('failed');
    expect(queue.records()[0].attempts).toBe(3);
    expect(queue.records()[0].error).toContain('application_error');
  });

  /*
    Request isolation on this transport. `enqueue` returns a record rather than a
    promise and the drain runs detached, so a send that fails every attempt still
    cannot surface as a rejection in the handler that triggered it.
  */
  it('never rejects into the caller, even when every attempt fails', async () => {
    const queue = queueOn(stubFetch([failure(401, 'missing_api_key', 'nope')]));

    expect(() => queue.enqueue(message())).not.toThrow();
    await expect(queue.idle()).resolves.toBeUndefined();
  });
});

describe('all six templates travel this path unchanged', () => {
  const MESSAGES: Record<MailKind, MailMessage> = {
    verify_email: {
      kind: 'verify_email',
      data: {
        name: 'Ada',
        verifyUrl: 'http://localhost:5173/verify-email?token=tok',
        expiresInHours: 24,
        isNewAccount: true,
      },
    },
    password_reset: {
      kind: 'password_reset',
      data: {
        name: 'Ada',
        resetUrl: 'http://localhost:5173/reset-password?token=tok',
        expiresInMinutes: 30,
      },
    },
    password_changed: { kind: 'password_changed', data: { name: 'Ada', via: 'settings' } },
    account_deleted: {
      kind: 'account_deleted',
      data: { name: 'Ada', purgeDate: '24 October 2026' },
    },
    account_restored: { kind: 'account_restored', data: { name: 'Ada' } },
    reminder_digest: {
      kind: 'reminder_digest',
      data: { name: 'Ada', items: [{ title: 'Follow up', dueLabel: 'Tomorrow, 9am' }] },
    },
    weekly_summary: {
      kind: 'weekly_summary',
      data: {
        name: 'Ada',
        weekLabel: '1-7 Sep',
        stats: {
          created: 3,
          applied: 2,
          responded: 1,
          interviewed: 1,
          offers: 0,
          responseRate: 50,
          currentStreakDays: 4,
          weeklyGoalTarget: 5,
          weeklyGoalCompleted: 2,
        },
        upcoming: [{ title: 'Interview', dueLabel: 'Monday, 10am' }],
      },
    },
    feedback: {
      kind: 'feedback',
      data: {
        category: 'bug',
        message: 'The board froze after a drag.',
        senderName: 'Ada',
        senderAccountEmail: 'ada@example.com',
        replyTo: 'ada@example.com',
      },
    },
  };

  it.each(MAIL_KINDS)('delivers the rendered %s intact over HTTP', async (kind) => {
    const isOptional = MAIL_CATEGORY[kind] === 'optional';
    const rendered = renderMail(
      MESSAGES[kind],
      {
        preferencesUrl: 'http://localhost:5173/settings',
        ...(isOptional
          ? {
              unsubscribeUrl: 'http://localhost:5000/api/v1/email/unsubscribe?token=abc',
              unsubscribeLabel: 'these emails',
            }
          : {}),
      },
      isOptional
        ? { 'List-Unsubscribe': '<http://localhost:5000/api/v1/email/unsubscribe?token=abc>' }
        : {},
    );

    const stub = stubFetch([ok()]);

    await createResendTransport({ apiKey: API_KEY, fetchImpl: stub.impl }).send({
      to: 'ada@example.com',
      kind,
      ...rendered,
    });

    // Identical to what renderMail produced: this transport is a courier, not a
    // second renderer, so the six templates cannot drift between the two paths.
    const body = bodyOf(stub);
    expect(body.subject).toBe(rendered.subject);
    expect(body.html).toBe(rendered.html);
    expect(body.text).toBe(rendered.text);
    expect(body.headers).toEqual(rendered.headers);
  });
});

describe('reply-to', () => {
  const base = {
    to: 'inbox@example.com',
    kind: 'feedback' as const,
    subject: 's',
    html: '<p>h</p>',
    text: 't',
    headers: {},
  };

  it('sends reply_to when the message carries one', async () => {
    const stub = stubFetch([ok()]);

    await createResendTransport({ apiKey: API_KEY, fetchImpl: stub.impl }).send({
      ...base,
      replyTo: 'ada@example.com',
    });

    expect(bodyOf(stub).reply_to).toBe('ada@example.com');
  });

  it('omits reply_to otherwise', async () => {
    const stub = stubFetch([ok()]);

    await createResendTransport({ apiKey: API_KEY, fetchImpl: stub.impl }).send(base);

    expect(bodyOf(stub)).not.toHaveProperty('reply_to');
  });
});
