import nodemailer, { type Transporter } from 'nodemailer';
import { env, isProduction } from '@/config/env';
import { logger } from '@/config/logger';
import type { MailKind } from '@/mail/types';

/**
 * The provider seam. Everything above this line renders messages; everything
 * below it is nodemailer.
 *
 * Provider-agnostic by construction: Resend, SendGrid, Mailgun and a plain relay
 * all expose SMTP, so a host, a port and a credential pair reach any of them.
 * There is no provider SDK to swap and no code path per vendor.
 */

export type MailTransportMode = 'smtp' | 'console';

export interface OutgoingMessage {
  to: string;
  kind: MailKind;
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
}

export interface MailTransport {
  readonly mode: MailTransportMode;
  /** Rejects on failure; the queue owns retrying. */
  send(message: OutgoingMessage): Promise<void>;
}

/**
 * Console unless SMTP is actually configured.
 *
 * An explicit `MAIL_TRANSPORT` wins, and the zod loader has already refused the
 * one incoherent combination (`smtp` with no host). Otherwise the presence of
 * `SMTP_HOST` is the signal, which is what makes zero email configuration a
 * working state rather than a boot failure.
 */
export function resolveTransportMode(): MailTransportMode {
  if (env.MAIL_TRANSPORT) return env.MAIL_TRANSPORT;

  return env.SMTP_HOST ? 'smtp' : 'console';
}

function buildTransporter(mode: MailTransportMode): Transporter {
  if (mode === 'console') {
    // `jsonTransport` runs the real MIME build — headers, both alternatives,
    // encoding — and hands back the result instead of opening a socket. So the
    // console path exercises the same composition the SMTP path does, and a
    // message that would fail to build fails here too rather than only once
    // there is a production relay to find out on.
    return nodemailer.createTransport({ jsonTransport: true });
  }

  return nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    // 465 is implicit TLS; 587 and 25 open in the clear and upgrade by STARTTLS.
    secure: env.SMTP_PORT === 465,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
  });
}

/**
 * Prints the message the console transport built.
 *
 * Outside production the whole body goes out, which is the point of the
 * fallback: a developer with no SMTP still has to be able to click the
 * verification link. In production only metadata is printed, because these
 * bodies carry verification and reset tokens and SPEC section 14 forbids logging
 * tokens or full email bodies. The body is interpolated into the message string
 * rather than passed as metadata — the logger redacts `html` and `text` keys, so
 * passing it as a field would print `[REDACTED]` and help nobody.
 */
function printToConsole(message: OutgoingMessage): void {
  if (isProduction) {
    logger.info('Mail rendered to console transport', { to: message.to, kind: message.kind });
    return;
  }

  logger.info(
    [
      'Mail rendered to console transport',
      `  to: ${message.to}`,
      `  subject: ${message.subject}`,
      '',
      message.text,
    ].join('\n'),
    { kind: message.kind },
  );
}

export function createMailTransport(): MailTransport {
  const mode = resolveTransportMode();
  const transporter = buildTransporter(mode);

  return {
    mode,
    async send(message: OutgoingMessage): Promise<void> {
      await transporter.sendMail({
        from: env.MAIL_FROM,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
        headers: message.headers,
      });

      if (mode === 'console') printToConsole(message);
    },
  };
}
