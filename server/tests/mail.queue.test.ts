import { MAIL_BASE_BACKOFF_MS, MAIL_MAX_ATTEMPTS, MailQueue, type MailRecord } from '@/mail/queue';
import type { MailTransport, OutgoingMessage } from '@/mail/transport';

/**
 * The retry schedule, proved without a clock.
 *
 * The queue takes its delay as a seam, so these cases assert the exact
 * millisecond values it *asked* to wait rather than measuring how long it
 * actually waited. That is deliberate given this project's history with
 * timing-sensitive tests: there is no wall clock here to run slow, no timer to
 * fire late, and nothing that behaves differently on a loaded CI box.
 */

interface FakeTransport extends MailTransport {
  readonly sent: OutgoingMessage[];
}

/** Fails its first `failures` sends, then succeeds. */
function fakeTransport(failures: number): FakeTransport {
  const sent: OutgoingMessage[] = [];
  let seen = 0;

  return {
    mode: 'console',
    sent,
    send(message: OutgoingMessage): Promise<void> {
      seen += 1;
      sent.push(message);

      if (seen <= failures) {
        return Promise.reject(new Error(`transport unavailable (attempt ${String(seen)})`));
      }

      return Promise.resolve();
    },
  };
}

function message(overrides: Partial<OutgoingMessage> = {}): OutgoingMessage {
  return {
    to: 'ada@example.com',
    kind: 'verify_email',
    subject: 'Confirm your email address',
    text: 'plain text body',
    html: '<p>html body</p>',
    headers: {},
    ...overrides,
  };
}

interface Harness {
  queue: MailQueue;
  transport: FakeTransport;
  delays: number[];
}

function harness(failures: number): Harness {
  const transport = fakeTransport(failures);
  const delays: number[] = [];

  const queue = new MailQueue({
    transport,
    delay: (ms) => {
      delays.push(ms);
      return Promise.resolve();
    },
  });

  return { queue, transport, delays };
}

describe('a send that always fails', () => {
  it('is attempted exactly three times and then given up on', async () => {
    const { queue, transport, delays } = harness(Number.POSITIVE_INFINITY);

    const record = queue.enqueue(message());
    await queue.idle();

    expect(MAIL_MAX_ATTEMPTS).toBe(3);
    expect(transport.sent).toHaveLength(3);
    expect(record.attempts).toBe(3);
    expect(record.outcome).toBe('failed');
    // Two gaps for three attempts: the queue does not sleep after giving up.
    expect(delays).toHaveLength(2);
  });

  it('backs off exponentially between attempts', async () => {
    const { queue, delays } = harness(Number.POSITIVE_INFINITY);

    queue.enqueue(message());
    await queue.idle();

    expect(delays).toEqual([MAIL_BASE_BACKOFF_MS, MAIL_BASE_BACKOFF_MS * 2]);
    // Doubling, not a fixed pause: the second gap is twice the first.
    expect(delays[1]).toBe(delays[0] * 2);
  });

  it('gives up cleanly, recording why without leaking the body', async () => {
    const { queue } = harness(Number.POSITIVE_INFINITY);

    const record = queue.enqueue(message());
    await queue.idle();

    expect(record.error).toContain('transport unavailable');
    expect(record.error).not.toContain('html body');
    expect(record.error).not.toContain('plain text body');
  });

  it('never rejects into the caller', async () => {
    const { queue } = harness(Number.POSITIVE_INFINITY);

    // `enqueue` is synchronous and returns a record, not a promise. There is
    // nothing here a request handler could await or catch, which is what makes a
    // failed email unable to fail the request that triggered it.
    const record: MailRecord = queue.enqueue(message());
    expect(record.outcome).toBe('pending');

    await expect(queue.idle()).resolves.toBeUndefined();
  });

  it('carries on to the next message after one exhausts its attempts', async () => {
    const transport = fakeTransport(MAIL_MAX_ATTEMPTS);
    const queue = new MailQueue({ transport, delay: () => Promise.resolve() });

    const doomed = queue.enqueue(message({ kind: 'verify_email' }));
    const follower = queue.enqueue(message({ kind: 'password_reset' }));
    await queue.idle();

    expect(doomed.outcome).toBe('failed');
    expect(follower.outcome).toBe('sent');
    expect(follower.attempts).toBe(1);
  });
});

describe('a send that succeeds', () => {
  it('is attempted once and never delayed', async () => {
    const { queue, transport, delays } = harness(0);

    const record = queue.enqueue(message());
    await queue.idle();

    expect(transport.sent).toHaveLength(1);
    expect(record.attempts).toBe(1);
    expect(record.outcome).toBe('sent');
    expect(delays).toEqual([]);
  });

  it('recovers on the second attempt after one transient failure', async () => {
    const { queue, transport, delays } = harness(1);

    const record = queue.enqueue(message());
    await queue.idle();

    expect(transport.sent).toHaveLength(2);
    expect(record.attempts).toBe(2);
    expect(record.outcome).toBe('sent');
    expect(record.error).toBeUndefined();
    expect(delays).toEqual([MAIL_BASE_BACKOFF_MS]);
  });

  it('recovers on the final attempt after two transient failures', async () => {
    const { queue, transport, delays } = harness(2);

    const record = queue.enqueue(message());
    await queue.idle();

    expect(transport.sent).toHaveLength(3);
    expect(record.attempts).toBe(3);
    expect(record.outcome).toBe('sent');
    expect(delays).toEqual([MAIL_BASE_BACKOFF_MS, MAIL_BASE_BACKOFF_MS * 2]);
  });

  it('hands the transport both bodies and the headers unchanged', async () => {
    const { queue, transport } = harness(0);

    queue.enqueue(
      message({ headers: { 'List-Unsubscribe': '<https://api.example.com/u?token=x>' } }),
    );
    await queue.idle();

    expect(transport.sent[0].text).toBe('plain text body');
    expect(transport.sent[0].html).toBe('<p>html body</p>');
    expect(transport.sent[0].headers['List-Unsubscribe']).toBe(
      '<https://api.example.com/u?token=x>',
    );
  });
});

describe('the retained record log', () => {
  it('keeps sends in order, newest last', async () => {
    const { queue } = harness(0);

    queue.enqueue(message({ kind: 'verify_email' }));
    queue.enqueue(message({ kind: 'password_reset' }));
    await queue.idle();

    expect(queue.records().map((record) => record.kind)).toEqual([
      'verify_email',
      'password_reset',
    ]);
  });

  it('is bounded, so a long-lived process cannot accumulate bodies', async () => {
    const { queue } = harness(0);

    for (let index = 0; index < 60; index += 1) queue.enqueue(message());
    await queue.idle();

    expect(queue.records()).toHaveLength(50);
  });

  it('empties on clear', async () => {
    const { queue } = harness(0);

    queue.enqueue(message());
    await queue.idle();
    queue.clear();

    expect(queue.records()).toHaveLength(0);
  });
});
