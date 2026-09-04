import { isProduction } from '@/config/env';
import { logger } from '@/config/logger';

export const MAIL_KINDS = [
  'verify_email',
  'password_reset',
  'password_changed',
  'account_deleted',
] as const;

export type MailKind = (typeof MAIL_KINDS)[number];

export interface OutboundMail {
  to: string;
  kind: MailKind;
  subject: string;
  text: string;
}

interface QueuedMail extends OutboundMail {
  queuedAt: Date;
}

/**
 * How many sends are retained for inspection. The queue is bounded so a long
 * running process cannot accumulate message bodies in memory.
 */
const MAX_RETAINED = 50;

const queue: QueuedMail[] = [];

/**
 * The transport seam for the four security emails this phase sends.
 *
 * SPEC section 13 puts the real transport, the templates and the retry queue in
 * Phase 12, but it also requires the app to boot and register with no SMTP
 * configuration at all. So this phase lands the shape Phase 12 fills in: a queue
 * with the message that was produced, and a console transport behind it.
 *
 * Two rules it already keeps, because they are security properties rather than
 * delivery details. A send never throws into the request that triggered it, as
 * section 13 requires. And the body is printed only outside production, because
 * these bodies carry verification and reset tokens and section 14 forbids
 * logging tokens or full email bodies; production logs the metadata alone.
 */
export function sendMail(mail: OutboundMail): void {
  try {
    queue.push({ ...mail, queuedAt: new Date() });
    if (queue.length > MAX_RETAINED) queue.splice(0, queue.length - MAX_RETAINED);

    if (isProduction) {
      logger.info('Mail queued', { to: mail.to, kind: mail.kind });
      return;
    }

    logger.info(`Mail queued\n  to: ${mail.to}\n  subject: ${mail.subject}\n\n${mail.text}\n`, {
      kind: mail.kind,
    });
  } catch (error) {
    logger.error('Mail could not be queued', { kind: mail.kind, error });
  }
}

/** Newest last. Used by the delivery tests and by Phase 12's transport. */
export function queuedMail(): readonly QueuedMail[] {
  return queue;
}

export function clearMailQueue(): void {
  queue.length = 0;
}
