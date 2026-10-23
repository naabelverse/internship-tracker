import { z } from 'zod';
import { FEEDBACK_CATEGORIES } from '@/mail/types';

/**
 * The unsubscribe link's only input. Length-capped like every other token in the
 * API; the signature check in `verifyUnsubscribeToken` is what actually decides
 * whether it is real.
 */
export const unsubscribeQuerySchema = z
  .object({ token: z.string().trim().min(1, 'is required').max(512) })
  .strict();

export type UnsubscribeQuery = z.infer<typeof unsubscribeQuerySchema>;

/** Mirrors the client form's counter. */
export const FEEDBACK_MESSAGE_MAX = 5000;

/** The reply address is the account's own email, so the form does not ask for one. */
export const feedbackSchema = z
  .object({
    category: z.enum(FEEDBACK_CATEGORIES),
    message: z.string().trim().min(1, 'is required').max(FEEDBACK_MESSAGE_MAX),
  })
  .strict();

export type FeedbackInput = z.infer<typeof feedbackSchema>;
