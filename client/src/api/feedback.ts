import { apiClient } from '@/api/client';

export const FEEDBACK_CATEGORIES = ['general', 'bug', 'suggestion'] as const;
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];

/** The server caps the message at this length too. */
export const FEEDBACK_MESSAGE_MAX = 5000;

export interface FeedbackPayload {
  category: FeedbackCategory;
  message: string;
  /** Empty means the sender wants no reply. */
  replyTo: string;
}

/** Mails the maintainer. The server answers 202 once the email is queued. */
export async function sendFeedback(payload: FeedbackPayload): Promise<void> {
  await apiClient.post('/email/feedback', payload);
}
