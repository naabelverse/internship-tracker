import { logger } from '@/config/logger';
import type { MailTransport, OutgoingMessage } from '@/mail/transport';
import type { MailKind } from '@/mail/types';

/** SPEC section 13: three attempts, then give up. */
export const MAIL_MAX_ATTEMPTS = 3;

/** Doubles per retry, so the gaps are 1s then 2s before the third attempt. */
export const MAIL_BASE_BACKOFF_MS = 1000;

/**
 * How many records are retained for inspection. Bounded so a long-running
 * process cannot accumulate message bodies in memory.
 */
const MAX_RETAINED = 50;

export type MailOutcome = 'pending' | 'sent' | 'failed';

export interface MailRecord {
  kind: MailKind;
  to: string;
  subject: string;
  /** Both bodies, retained so tests and the console path can read what was built. */
  text: string;
  html: string;
  headers: Record<string, string>;
  queuedAt: Date;
  attempts: number;
  outcome: MailOutcome;
  /** The final failure message, when there was one. Never a token or a body. */
  error?: string;
}

export interface MailQueueOptions {
  transport: MailTransport;
  /**
   * The backoff seam. Injected rather than reaching for `setTimeout` directly so
   * a test can assert the exact delays without waiting through them — the retry
   * schedule is a property worth proving, and proving it against a wall clock is
   * how timing-flaky tests get written.
   */
  delay?: (ms: number) => Promise<void>;
  maxAttempts?: number;
  baseBackoffMs?: number;
}

function realDelay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * A serial, in-process send queue with bounded retry.
 *
 * `enqueue` is synchronous and returns immediately. The drain loop runs detached
 * and turns every failure into a log line, which is how "a failed email never
 * fails the HTTP request that triggered it" is actually enforced: the request
 * handler holds no promise it could await and no error it could propagate.
 * Nothing in this class ever rejects into a caller.
 */
export class MailQueue {
  private readonly transport: MailTransport;
  private readonly delay: (ms: number) => Promise<void>;
  private readonly maxAttempts: number;
  private readonly baseBackoffMs: number;

  private readonly pending: MailRecord[] = [];
  private readonly retained: MailRecord[] = [];
  private draining: Promise<void> = Promise.resolve();

  constructor(options: MailQueueOptions) {
    this.transport = options.transport;
    this.delay = options.delay ?? realDelay;
    this.maxAttempts = options.maxAttempts ?? MAIL_MAX_ATTEMPTS;
    this.baseBackoffMs = options.baseBackoffMs ?? MAIL_BASE_BACKOFF_MS;
  }

  /** Fire and forget. Never throws, and hands back no promise to await. */
  enqueue(message: OutgoingMessage): MailRecord {
    const record: MailRecord = {
      ...message,
      queuedAt: new Date(),
      attempts: 0,
      outcome: 'pending',
    };

    this.pending.push(record);
    this.retained.push(record);
    if (this.retained.length > MAX_RETAINED) {
      this.retained.splice(0, this.retained.length - MAX_RETAINED);
    }

    this.scheduleDrain();

    return record;
  }

  /**
   * Resolves once the queue has nothing left in flight. Tests await this; the
   * request path never does.
   */
  async idle(): Promise<void> {
    // A caller may enqueue again while a drain is mid-flight, so settle
    // repeatedly until both the backlog and the in-flight loop are done.
    while (this.pending.length > 0) {
      await this.draining;
    }

    await this.draining;
  }

  records(): readonly MailRecord[] {
    return this.retained;
  }

  clear(): void {
    this.retained.length = 0;
  }

  private scheduleDrain(): void {
    this.draining = this.draining.then(() => this.drain());
  }

  private async drain(): Promise<void> {
    while (this.pending.length > 0) {
      const record = this.pending.shift();
      if (record) await this.deliver(record);
    }
  }

  /**
   * One message, up to `maxAttempts` times. Every outcome is logged: a success
   * with its attempt count, each retry with the gap before the next try, and the
   * final give-up at error level.
   */
  private async deliver(record: MailRecord): Promise<void> {
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      record.attempts = attempt;

      try {
        await this.transport.send({
          to: record.to,
          kind: record.kind,
          subject: record.subject,
          html: record.html,
          text: record.text,
          headers: record.headers,
        });

        record.outcome = 'sent';
        logger.info('Mail sent', {
          kind: record.kind,
          to: record.to,
          attempts: attempt,
          transport: this.transport.mode,
        });

        return;
      } catch (error) {
        const reason = describeError(error);

        if (attempt === this.maxAttempts) {
          record.outcome = 'failed';
          record.error = reason;
          logger.error('Mail gave up after every attempt', {
            kind: record.kind,
            to: record.to,
            attempts: attempt,
            transport: this.transport.mode,
            reason,
          });

          return;
        }

        const backoffMs = this.baseBackoffMs * 2 ** (attempt - 1);
        logger.warn('Mail send failed, retrying', {
          kind: record.kind,
          to: record.to,
          attempt,
          backoffMs,
          reason,
        });

        await this.delay(backoffMs);
      }
    }
  }
}
