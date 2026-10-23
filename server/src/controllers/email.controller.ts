import { logger } from '@/config/logger';
import { getAuthenticatedUser } from '@/middleware/requireAuth';
import { escapeHtml } from '@/mail/layout';
import { preferencesUrl } from '@/mail/links';
import { verifyUnsubscribeToken, type UnsubscribeClaim } from '@/mail/unsubscribe';
import { User } from '@/models/User';
import type { FeedbackInput, UnsubscribeQuery } from '@/schemas/email.schema';
import { sendFeedback } from '@/services/feedback.service';
import { ApiError } from '@/utils/ApiError';
import { sendSuccess } from '@/utils/apiResponse';
import { asyncHandler } from '@/utils/asyncHandler';
import { MAIL_PALETTE } from '@/mail/palette';

/**
 * The unsubscribe link from a reminder digest or a weekly summary.
 *
 * Unauthenticated on purpose: the signed token is the credential, and requiring
 * a session would make the link useless to the person most likely to click it.
 * It is also strictly subtractive — the only thing either verb can do is switch
 * one preference off — so there is nothing here for a forged link to gain even
 * if the signature could be produced.
 */

const FIELD_BY_CATEGORY = {
  reminders: 'emailRemindersEnabled',
  weekly_summary: 'weeklySummaryEnabled',
} as const;

const LABEL_BY_CATEGORY = {
  reminders: 'reminder emails',
  weekly_summary: 'the weekly summary',
} as const;

async function applyUnsubscribe(token: string): Promise<UnsubscribeClaim> {
  const claim = verifyUnsubscribeToken(token);

  if (!claim) {
    throw ApiError.badRequest('That unsubscribe link is not valid', 'INVALID_TOKEN');
  }

  const result = await User.updateOne(
    { _id: claim.userId, deletedAt: null },
    { $set: { [FIELD_BY_CATEGORY[claim.category]]: false } },
  );

  // A closed or purged account has nothing to switch off, and saying so would
  // turn the link into an account-existence oracle. The caller is told it worked
  // either way; the log carries the truth.
  logger.info('Unsubscribe applied', { category: claim.category, matched: result.matchedCount });

  return claim;
}

/**
 * A minimal confirmation page.
 *
 * Served from the API rather than the client because the whole point is that it
 * works with no session: sending the reader to a protected route would bounce
 * them into a sign-in form immediately after they asked to stop hearing from us.
 */
function confirmationPage(message: string): string {
  // Same generated palette the emails use. This page is the last step of the
  // unsubscribe flow, so a stale indigo here would undo the fix one click later.
  const { brand, canvas, ink, muted, surface } = MAIL_PALETTE;

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Unsubscribed</title>
</head>
<body style="margin:0;background:${canvas};font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;">
<main style="max-width:32rem;margin:4rem auto;padding:2rem;background:${surface};border-radius:12px;">
<h1 style="margin:0 0 .75rem;font-size:1.25rem;color:${ink};">You are unsubscribed</h1>
<p style="margin:0 0 1rem;font-size:.9375rem;line-height:1.6;color:${muted};">${escapeHtml(message)}</p>
<p style="margin:0;font-size:.9375rem;line-height:1.6;color:${muted};">
<a href="${escapeHtml(preferencesUrl())}" style="color:${brand};">Manage all email preferences</a>
</p>
</main>
</body></html>`;
}

/** The link a person clicks. Applies the change and says so in plain language. */
export const unsubscribe = asyncHandler(async (req, res) => {
  const { token } = req.query as unknown as UnsubscribeQuery;
  const claim = await applyUnsubscribe(token);

  res
    .status(200)
    .type('html')
    .send(
      confirmationPage(
        `You will no longer receive ${LABEL_BY_CATEGORY[claim.category]}. Security emails about your account — verification, password changes and account closure — still reach you.`,
      ),
    );
});

/**
 * The RFC 8058 one-click endpoint. Gmail and Outlook POST here themselves from
 * the `List-Unsubscribe` header, with no human ever seeing a page, so this
 * answers in the standard JSON envelope rather than with HTML.
 */
export const unsubscribeOneClick = asyncHandler(async (req, res) => {
  const { token } = req.query as unknown as UnsubscribeQuery;
  const claim = await applyUnsubscribe(token);

  sendSuccess(res, { category: claim.category }, { message: 'Unsubscribed' });
});

/** The in-app feedback form. Accepted once queued; delivery happens after the response. */
export const feedback = asyncHandler(async (req, res) => {
  const user = getAuthenticatedUser(req);

  await sendFeedback(user._id, req.body as FeedbackInput);

  sendSuccess(res, null, { status: 202, message: 'Feedback sent' });
});
