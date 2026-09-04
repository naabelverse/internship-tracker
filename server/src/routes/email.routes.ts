import { Router } from 'express';
import * as email from '@/controllers/email.controller';
import { validateQuery } from '@/middleware/validate';
import { unsubscribeQuerySchema } from '@/schemas/email.schema';

/**
 * The only unauthenticated write in the API. `requireAuth` is deliberately
 * absent: the signed token in the query is the credential, and the single field
 * it can reach can only ever be set to false.
 */
const router = Router();

router.get('/unsubscribe', validateQuery(unsubscribeQuerySchema), email.unsubscribe);
router.post('/unsubscribe', validateQuery(unsubscribeQuerySchema), email.unsubscribeOneClick);

export default router;
