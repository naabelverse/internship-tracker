import type { Request } from 'express';
import { getAuthenticatedUser } from '@/middleware/requireAuth';
import type {
  ChangePasswordInput,
  DeleteAccountInput,
  ForgotPasswordInput,
  LoginInput,
  RegisterInput,
  ResetPasswordInput,
  UpdateMeInput,
  VerifyEmailInput,
} from '@/schemas/auth.schema';
import * as accountLifecycle from '@/services/accountLifecycle.service';
import * as authService from '@/services/auth.service';
import { exportAccountData, exportFilename } from '@/services/dataExport.service';
import * as sessionService from '@/services/session.service';
import { getAccountUsage } from '@/services/usage.service';
import { rotateSession, type SessionContext } from '@/services/token.service';
import { ApiError } from '@/utils/ApiError';
import { asyncHandler } from '@/utils/asyncHandler';
import { sendSuccess } from '@/utils/apiResponse';
import { REFRESH_COOKIE_NAME, clearRefreshCookie, setRefreshCookie } from '@/utils/cookies';

/** Device fingerprint stored against a refresh token so users can audit sessions. */
function sessionContext(req: Request): SessionContext {
  return { userAgent: req.get('user-agent'), ip: req.ip };
}

function readRefreshCookie(req: Request): string | undefined {
  const cookies: unknown = req.cookies;
  const value = (cookies as Record<string, unknown> | undefined)?.[REFRESH_COOKIE_NAME];

  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export const register = asyncHandler(async (req, res) => {
  const { user, session } = await authService.register(
    req.body as RegisterInput,
    sessionContext(req),
  );

  setRefreshCookie(res, session.refreshToken);
  sendSuccess(
    res,
    { user: user.toJSON(), accessToken: session.accessToken },
    { status: 201, message: 'Account created' },
  );
});

/**
 * "Try the demo". Deliberately takes no body — see `loginAsDemo` for why that is
 * a security property rather than a convenience.
 */
export const demoLogin = asyncHandler(async (req, res) => {
  const { user, session } = await authService.loginAsDemo(sessionContext(req));

  setRefreshCookie(res, session.refreshToken);
  sendSuccess(
    res,
    { user: user.toJSON(), accessToken: session.accessToken },
    { message: 'Signed in to the demo account' },
  );
});

export const login = asyncHandler(async (req, res) => {
  const { user, session } = await authService.login(req.body as LoginInput, sessionContext(req));

  setRefreshCookie(res, session.refreshToken);
  sendSuccess(
    res,
    { user: user.toJSON(), accessToken: session.accessToken },
    { message: 'Signed in' },
  );
});

export const refresh = asyncHandler(async (req, res) => {
  const raw = readRefreshCookie(req);

  if (!raw) {
    throw ApiError.unauthorized('No refresh token was provided', 'MISSING_REFRESH_TOKEN');
  }

  try {
    const rotated = await rotateSession(raw, sessionContext(req));
    setRefreshCookie(res, rotated.refreshToken);
    sendSuccess(res, { accessToken: rotated.accessToken });
  } catch (error) {
    // Not swallowed: a cookie that can never rotate again is dead weight that
    // would keep failing every request, so drop it before rethrowing.
    clearRefreshCookie(res);
    throw error;
  }
});

export const logout = asyncHandler(async (req, res) => {
  await authService.logout(readRefreshCookie(req));

  clearRefreshCookie(res);
  sendSuccess(res, { loggedOut: true }, { message: 'Signed out' });
});

export const logoutAll = asyncHandler(async (req, res) => {
  const user = getAuthenticatedUser(req);
  const revoked = await authService.logoutAll(user._id);

  clearRefreshCookie(res);
  sendSuccess(res, { revokedSessions: revoked }, { message: 'Signed out on every device' });
});

export const me = asyncHandler(async (req, res) => {
  const user = await authService.getMe(getAuthenticatedUser(req)._id);

  sendSuccess(res, { user: user.toJSON() });
});

/**
 * SPEC section 12's "single JSON download containing everything the system
 * stores about the user".
 *
 * Sent as a download rather than inside the usual envelope, for the same reason
 * the CSV export is: the file the user saves should be the export itself, not an
 * export nested under a `data` key they have to unwrap before anything can read
 * it.
 */
export const exportData = asyncHandler(async (req, res) => {
  const user = getAuthenticatedUser(req);
  const account = await exportAccountData(user._id);

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${exportFilename()}"`);
  res.send(JSON.stringify(account, null, 2));
});

/** What the account is using against SPEC section 12's per-account ceilings. */
export const usage = asyncHandler(async (req, res) => {
  const user = getAuthenticatedUser(req);

  sendSuccess(res, await getAccountUsage(user._id));
});

export const updateMe = asyncHandler(async (req, res) => {
  const user = await authService.updateMe(getAuthenticatedUser(req)._id, req.body as UpdateMeInput);

  sendSuccess(res, { user: user.toJSON() }, { message: 'Profile updated' });
});

export const changePassword = asyncHandler(async (req, res) => {
  const { user, session } = await authService.changePassword(
    getAuthenticatedUser(req)._id,
    req.body as ChangePasswordInput,
    sessionContext(req),
  );

  setRefreshCookie(res, session.refreshToken);
  sendSuccess(
    res,
    { user: user.toJSON(), accessToken: session.accessToken },
    { message: 'Password changed. Every other session has been signed out.' },
  );
});

export const verifyEmail = asyncHandler(async (req, res) => {
  const user = await accountLifecycle.verifyEmail((req.body as VerifyEmailInput).token);

  sendSuccess(res, { user: user.toJSON() }, { message: 'Email address confirmed' });
});

export const resendVerification = asyncHandler(async (req, res) => {
  await accountLifecycle.resendVerification(getAuthenticatedUser(req)._id);

  sendSuccess(res, { sent: true }, { message: 'A new confirmation link is on its way' });
});

/**
 * SPEC section 5 and the definition of done: this must be indistinguishable for
 * an address that exists and one that does not.
 *
 * Identity is structural rather than two branches that happen to agree. The
 * handler never asks whether the account exists; it answers with one fixed
 * literal and only then hands the address to the service, which does the token
 * work for a real account and nothing for anything else. Because the response is
 * already written, the one operation whose cost depends on the answer - a token
 * write - is outside anything a client can time. Note there is no bcrypt on this
 * path at all: unlike login, nothing here hashes a password, so the difference
 * being hidden is a single indexed write rather than a key derivation.
 */
export const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body as ForgotPasswordInput;

  sendSuccess(
    res,
    { requested: true },
    { message: 'If that address has an account, a reset link is on its way.' },
  );

  await accountLifecycle.startPasswordReset(email);
});

export const resetPassword = asyncHandler(async (req, res) => {
  const { token, password } = req.body as ResetPasswordInput;
  await accountLifecycle.resetPassword(token, password);

  clearRefreshCookie(res);
  sendSuccess(
    res,
    { reset: true },
    { message: 'Password reset. Every signed in device has been signed out.' },
  );
});

export const listSessions = asyncHandler(async (req, res) => {
  const sessions = await sessionService.listSessions(
    getAuthenticatedUser(req)._id,
    readRefreshCookie(req),
  );

  sendSuccess(res, { sessions });
});

export const revokeSession = asyncHandler(async (req, res) => {
  await sessionService.revokeSession(getAuthenticatedUser(req)._id, req.params.id);

  sendSuccess(res, { revoked: true }, { message: 'That device has been signed out' });
});

export const deleteMe = asyncHandler(async (req, res) => {
  await accountLifecycle.deleteAccount(
    getAuthenticatedUser(req)._id,
    (req.body as DeleteAccountInput).password,
  );

  clearRefreshCookie(res);
  sendSuccess(
    res,
    { deleted: true },
    { message: 'Your account is closed. Your data is removed permanently after 30 days.' },
  );
});
