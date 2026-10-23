import { apiClient } from '@/api/client';

export const FEEDBACK_CATEGORIES = ['general', 'bug', 'suggestion'] as const;
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];

/** The server caps the message at this length too. */
export const FEEDBACK_MESSAGE_MAX = 5000;

export interface FeedbackPayload {
  category: FeedbackCategory;
  message: string;
}

/** Mails the maintainer, replying to the account email. Answers 202 once queued. */
export async function sendFeedback(payload: FeedbackPayload): Promise<void> {
  await apiClient.post('/email/feedback', payload);
}
