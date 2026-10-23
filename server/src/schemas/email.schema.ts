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

/** An empty `replyTo` means the sender cleared the field and wants no reply. */
export const feedbackSchema = z
  .object({
    category: z.enum(FEEDBACK_CATEGORIES),
    message: z.string().trim().min(1, 'is required').max(FEEDBACK_MESSAGE_MAX),
    replyTo: z
      .union([
        z.literal(''),
        z.string().trim().toLowerCase().email('must be a valid email address').max(254),
      ])
      .optional(),
  })
  .strict();

export type FeedbackInput = z.infer<typeof feedbackSchema>;
