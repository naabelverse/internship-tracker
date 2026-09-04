import { Router } from 'express';
import {
  changePassword,
  deleteMe,
  forgotPassword,
  listSessions,
  login,
  logout,
  logoutAll,
  me,
  refresh,
  register,
  resendVerification,
  resetPassword,
  revokeSession,
  updateMe,
  verifyEmail,
} from '@/controllers/auth.controller';
import {
  forgotPasswordEmailLimiter,
  forgotPasswordIpLimiter,
  loginEmailLimiter,
  loginIpLimiter,
  registerEmailLimiter,
  registerIpLimiter,
  resendVerificationLimiter,
  resetPasswordIpLimiter,
} from '@/middleware/rateLimit';
import { requireAuth } from '@/middleware/requireAuth';
import { validateBody } from '@/middleware/validate';
import {
  changePasswordSchema,
  deleteAccountSchema,
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  updateMeSchema,
  verifyEmailSchema,
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

// Verification and reset are unauthenticated on purpose: the token in the body
// is the credential, and requiring a session would make a reset useless to the
// person who cannot get in.
router.post('/verify-email', validateBody(verifyEmailSchema), verifyEmail);
router.post('/resend-verification', requireAuth, resendVerificationLimiter, resendVerification);

router.post(
  '/forgot-password',
  forgotPasswordIpLimiter,
  forgotPasswordEmailLimiter,
  validateBody(forgotPasswordSchema),
  forgotPassword,
);

router.post(
  '/reset-password',
  resetPasswordIpLimiter,
  validateBody(resetPasswordSchema),
  resetPassword,
);

router.get('/sessions', requireAuth, listSessions);
router.delete('/sessions/:id', requireAuth, revokeSession);

router.delete('/me', requireAuth, validateBody(deleteAccountSchema), deleteMe);

export default router;
