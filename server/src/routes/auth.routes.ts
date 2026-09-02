import { Router } from 'express';
import {
  changePassword,
  login,
  logout,
  logoutAll,
  me,
  refresh,
  register,
  updateMe,
} from '@/controllers/auth.controller';
import {
  loginEmailLimiter,
  loginIpLimiter,
  registerEmailLimiter,
  registerIpLimiter,
} from '@/middleware/rateLimit';
import { requireAuth } from '@/middleware/requireAuth';
import { validateBody } from '@/middleware/validate';
import {
  changePasswordSchema,
  loginSchema,
  registerSchema,
  updateMeSchema,
} from '@/schemas/auth.schema';

const router = Router();

// Limiters run before validation on purpose: a malformed body must still count
// against the attempt budget, otherwise the limit is trivially bypassed.
router.post(
  '/register',
  registerIpLimiter,
  registerEmailLimiter,
  validateBody(registerSchema),
  register,
);

router.post('/login', loginIpLimiter, loginEmailLimiter, validateBody(loginSchema), login);

// Refresh and logout authenticate with the cookie, so they must work even once
// the access token has expired.
router.post('/refresh', refresh);
router.post('/logout', logout);

router.post('/logout-all', requireAuth, logoutAll);
router.get('/me', requireAuth, me);
router.patch('/me', requireAuth, validateBody(updateMeSchema), updateMe);
router.patch('/me/password', requireAuth, validateBody(changePasswordSchema), changePassword);

export default router;
