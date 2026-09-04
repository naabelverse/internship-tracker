import { logger } from '@/config/logger';
import type { MailFooter } from '@/mail/layout';
import { preferencesUrl } from '@/mail/links';
import { MailQueue, type MailQueueOptions, type MailRecord } from '@/mail/queue';
import type { UserDocument } from '@/models/User';
import { renderMail } from '@/mail/templates';
import { createMailTransport, resolveTransportMode } from '@/mail/transport';
import { unsubscribeHeaders, unsubscribeUrl } from '@/mail/unsubscribe';
import {
  MAIL_UNSUBSCRIBE_CATEGORY,
  type MailKind,
  type MailRecipient,
  type OptionalMailKind,
  type OptionalMessage,
  type SecurityMessage,
} from '@/mail/types';

export type { MailKind } from '@/mail/types';
export type { MailRecord } from '@/mail/queue';

/**
 * The single door every email leaves through.
 *
 * Three things happen here and nowhere else: the preference gate, the footer and
 * its unsubscribe headers, and handing the message to the retry queue. Callers
 * pass data, never a rendered body, so no caller can skip the layout or the gate.
 */

/**
 * Security mail needs no recipient record, because no preference can suppress
 * it. Optional mail requires one, and the type makes that a compile error rather
 * than a runtime check someone could forget: the gate cannot be bypassed by
 * simply not passing the preferences it reads.
 */
export type SendMailInput =
  | { to: string; message: SecurityMessage; recipient?: MailRecipient }
  | { to: string; message: OptionalMessage; recipient: MailRecipient };

let queue: MailQueue | undefined;

function activeQueue(): MailQueue {
  queue ??= new MailQueue({ transport: createMailTransport() });

  return queue;
}

/**
 * Replaces the process-wide queue. Tests use it to inject a transport that fails
 * on purpose, together with a delay they can observe instead of wait through.
 */
export function configureMailer(options: MailQueueOptions): void {
  queue = new MailQueue(options);
}

/** Drops the configured queue so the next send rebuilds it from the environment. */
export function resetMailer(): void {
  queue = undefined;
}

/**
 * Builds the queue and announces the resolved transport, once, at boot. Calling
 * it early means a mail misconfiguration shows up in the startup log rather than
 * in the first registration of the day.
 */
export function initMailer(): void {
  activeQueue();
  // `resolveTransportMode` rather than the transport's own `mode`: reading it
  // off a second `createMailTransport()` would build — and, on SMTP, connect —
  // an entire extra transporter purely to log one word.
  logger.info('Mail transport ready', { transport: resolveTransportMode() });
}

/**
 * True when this recipient still wants this kind of mail. Security mail is
 * always true; each optional kind reads its own preference, so switching off
 * reminders does not silently also cancel the weekly summary.
 */
export function allowsMail(kind: MailKind, recipient: MailRecipient): boolean {
  switch (kind) {
    case 'reminder_digest':
      return recipient.emailRemindersEnabled;
    case 'weekly_summary':
      return recipient.weeklySummaryEnabled;
    default:
      return true;
  }
}

function optionalFooter(
  kind: OptionalMailKind,
  recipient: MailRecipient,
): { footer: MailFooter; headers: Record<string, string> } {
  const category = MAIL_UNSUBSCRIBE_CATEGORY[kind];
  const url = unsubscribeUrl(recipient.id, category);
  const label = category === 'reminders' ? 'reminder emails' : 'the weekly summary';

  return {
    footer: { preferencesUrl: preferencesUrl(), unsubscribeUrl: url, unsubscribeLabel: label },
    headers: unsubscribeHeaders(url),
  };
}

/**
 * Queues an email. Returns nothing and throws nothing.
 *
 * This is the whole of "a failed email must never fail the HTTP request that
 * triggered it": the call is synchronous, hands back no promise, and wraps
 * rendering in a catch of its own. A controller cannot await delivery even by
 * accident, and a transport that is down produces a log line rather than a 500.
 */
export function sendMail(input: SendMailInput): void {
  try {
    const { message } = input;

    if (message.kind === 'reminder_digest' || message.kind === 'weekly_summary') {
      const { recipient } = input;

      if (!recipient) {
        // The public type makes this unreachable; reaching it means someone cast
        // past it. Fail closed — unsolicited mail is worse than a missing digest.
        logger.error('Optional mail suppressed: no recipient preferences supplied', {
          kind: message.kind,
        });
        return;
      }

      if (!allowsMail(message.kind, recipient)) {
        logger.info('Mail suppressed by preference', { kind: message.kind, to: input.to });
        return;
      }

      const { footer, headers } = optionalFooter(message.kind, recipient);
      const rendered = renderMail(message, footer, headers);

      activeQueue().enqueue({
        to: input.to,
        kind: message.kind,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        headers: rendered.headers,
      });

      return;
    }

    // Security mail: no gate, no unsubscribe link, only the preferences link
    // every message carries.
    const rendered = renderMail(message, { preferencesUrl: preferencesUrl() });

    activeQueue().enqueue({
      to: input.to,
      kind: message.kind,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      headers: rendered.headers,
    });
  } catch (error) {
    logger.error('Mail could not be queued', {
      kind: input.message.kind,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Narrows a user document to the three fields the gate reads. The model is a
 * type-only import, so this adds no runtime dependency from the mail layer to
 * the data layer.
 */
export function mailRecipientFor(user: UserDocument): MailRecipient {
  return {
    id: user._id.toString(),
    emailRemindersEnabled: user.emailRemindersEnabled,
    weeklySummaryEnabled: user.weeklySummaryEnabled,
  };
}

/** Newest last. Used by the delivery tests. */
export function queuedMail(): readonly MailRecord[] {
  return activeQueue().records();
}

export function clearMailQueue(): void {
  activeQueue().clear();
}

/** Resolves once nothing is in flight. Tests await this; request handlers never do. */
export function mailQueueIdle(): Promise<void> {
  return activeQueue().idle();
}
