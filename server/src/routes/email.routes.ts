import { Router } from 'express';
import * as email from '@/controllers/email.controller';
import { feedbackLimiter } from '@/middleware/rateLimit';
import { requireAuth } from '@/middleware/requireAuth';
import { validateBody, validateQuery } from '@/middleware/validate';
import { feedbackSchema, unsubscribeQuerySchema } from '@/schemas/email.schema';

/**
 * Unsubscribe is the only unauthenticated write in the API. `requireAuth` is
 * deliberately absent there: the signed token in the query is the credential,
 * and the single field it can reach can only ever be set to false. Feedback, by
 * contrast, needs a session, and runs `requireAuth` before its per-account limiter.
 */
const router = Router();

router.get('/unsubscribe', validateQuery(unsubscribeQuerySchema), email.unsubscribe);
router.post('/unsubscribe', validateQuery(unsubscribeQuerySchema), email.unsubscribeOneClick);
router.post(
  '/feedback',
  requireAuth,
  feedbackLimiter,
  validateBody(feedbackSchema),
  email.feedback,
);

export default router;
