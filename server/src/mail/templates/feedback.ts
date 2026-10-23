import type { MailBlock } from '@/mail/layout';
import type { FeedbackCategory, FeedbackData } from '@/mail/types';
import type { TemplateOutput } from '@/mail/templates/security';

const LABEL: Record<FeedbackCategory, string> = {
  general: 'General feedback',
  bug: 'Bug report',
  suggestion: 'Suggestion',
};

/**
 * Feedback from the in-app form, addressed to the maintainer. It greets nobody:
 * the reader is the operator, and the sender is named in the heading instead.
 */
export function feedbackTemplate(data: FeedbackData): TemplateOutput {
  const label = LABEL[data.category];
  const paragraphs: MailBlock[] = data.message
    .split(/\n{2,}/)
    .map((text) => ({ type: 'paragraph', text: text.trim() }));

  return {
    subject: `[${label}] from ${data.senderName}`,
    heading: `${label} from ${data.senderName}`,
    preheader: data.message.slice(0, 120),
    blocks: [
      ...paragraphs,
      {
        type: 'note',
        text: data.replyTo
          ? `Sent from the account ${data.senderAccountEmail}. Replying to this email reaches ${data.replyTo}.`
          : `Sent from the shared demo account (${data.senderAccountEmail}), so there is no one to reply to.`,
      },
    ],
  };
}
