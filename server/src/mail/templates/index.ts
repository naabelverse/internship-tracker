import { renderHtml, renderText, type MailFooter } from '@/mail/layout';
import { reminderDigestTemplate, weeklySummaryTemplate } from '@/mail/templates/digests';
import {
  accountDeletedTemplate,
  passwordChangedTemplate,
  passwordResetTemplate,
  verifyEmailTemplate,
  type TemplateOutput,
} from '@/mail/templates/security';
import type { MailMessage, RenderedMail } from '@/mail/types';

/**
 * The one place a message becomes an email.
 *
 * Templates return content; this applies the shared shell and produces both
 * bodies from the same block list. Because nothing else calls `renderHtml`, no
 * template can grow its own masthead or forget the plain-text alternative.
 */
function contentFor(message: MailMessage): TemplateOutput {
  switch (message.kind) {
    case 'verify_email':
      return verifyEmailTemplate(message.data);
    case 'password_reset':
      return passwordResetTemplate(message.data);
    case 'password_changed':
      return passwordChangedTemplate(message.data);
    case 'account_deleted':
      return accountDeletedTemplate(message.data);
    case 'reminder_digest':
      return reminderDigestTemplate(message.data);
    case 'weekly_summary':
      return weeklySummaryTemplate(message.data);
  }
}

export function renderMail(
  message: MailMessage,
  footer: MailFooter,
  headers: Record<string, string> = {},
): RenderedMail {
  const { subject, heading, preheader, blocks } = contentFor(message);
  const layout = { heading, preheader, blocks, footer };

  return {
    subject,
    html: renderHtml(layout),
    text: renderText(layout),
    headers,
  };
}
