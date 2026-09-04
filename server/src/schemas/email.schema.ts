import { z } from 'zod';

/**
 * The unsubscribe link's only input. Length-capped like every other token in the
 * API; the signature check in `verifyUnsubscribeToken` is what actually decides
 * whether it is real.
 */
export const unsubscribeQuerySchema = z
  .object({ token: z.string().trim().min(1, 'is required').max(512) })
  .strict();

export type UnsubscribeQuery = z.infer<typeof unsubscribeQuerySchema>;
