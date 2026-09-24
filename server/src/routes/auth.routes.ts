import { Router } from 'express';
import {
  changePassword,
  deleteMe,
  demoLogin,
  exportData,
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
  restore,
  revokeSession,
  updateMe,
  usage,
  verifyEmail,
} from '@/controllers/auth.controller';
import {
  demoLoginIpLimiter,
  exportLimiter,
  forgotPasswordEmailLimiter,
  forgotPasswordIpLimiter,
  loginEmailLimiter,
  loginIpLimiter,
  registerEmailLimiter,
  registerIpLimiter,
  resendVerificationLimiter,
  resetPasswordIpLimiter,
  restoreIpLimiter,
} from '@/middleware/rateLimit';
import { changesEmail, rejectDemoAccount } from '@/middleware/rejectDemoAccount';
import { requireAuth } from '@/middleware/requireAuth';
import { validateBody } from '@/middleware/validate';
import {
  changePasswordSchema,
  deleteAccountSchema,
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  restoreAccountSchema,
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

// Unauthenticated on purpose: a closed account has no session. The token from
// the login's 409 is the credential, and it is single use and short lived.
router.post('/restore', restoreIpLimiter, validateBody(restoreAccountSchema), restore);

// No body, and no `validateBody`: there is nothing to validate, which is
// precisely what stops this route being pointed at any account but the seeded
// demo one. See `loginAsDemo`.
router.post('/demo', demoLoginIpLimiter, demoLogin);

// Refresh and logout authenticate with the cookie, so they must work even once
// the access token has expired.
router.post('/refresh', refresh);
router.post('/logout', logout);

router.post('/logout-all', requireAuth, logoutAll);
router.get('/me', requireAuth, me);
// The demo guard runs after validation on the profile patch, so `changesEmail`
// reads a parsed body rather than guessing at a raw one.
router.patch(
  '/me',
  requireAuth,
  validateBody(updateMeSchema),
  rejectDemoAccount({ when: changesEmail }),
  updateMe,
);
router.patch(
  '/me/password',
  requireAuth,
  rejectDemoAccount(),
  validateBody(changePasswordSchema),
  changePassword,
);

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

// Reading the whole account is far more expensive than any other GET here, so
// it carries its own per-account limit on top of the global one.
router.get('/me/export', requireAuth, exportLimiter, exportData);
router.get('/me/usage', requireAuth, usage);

router.get('/sessions', requireAuth, listSessions);
router.delete('/sessions/:id', requireAuth, revokeSession);

router.delete('/me', requireAuth, rejectDemoAccount(), validateBody(deleteAccountSchema), deleteMe);

export default router;
