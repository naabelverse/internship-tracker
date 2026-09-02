import { getAuthenticatedUser } from '@/middleware/requireAuth';
import type { TimelineQuery, TopCompaniesQuery } from '@/schemas/analytics.schema';
import * as analytics from '@/services/analytics.service';
import { asyncHandler } from '@/utils/asyncHandler';
import { sendSuccess } from '@/utils/apiResponse';

export const summary = asyncHandler(async (req, res) => {
  const user = getAuthenticatedUser(req);

  const data = await analytics.getSummary(user._id, user.timezone, user.weeklyGoal);

  sendSuccess(res, data);
});

export const statusBreakdown = asyncHandler(async (req, res) => {
  const user = getAuthenticatedUser(req);

  sendSuccess(res, { breakdown: await analytics.getStatusBreakdown(user._id) });
});

export const timeline = asyncHandler(async (req, res) => {
  const user = getAuthenticatedUser(req);
  const { granularity, range } = req.query as unknown as TimelineQuery;

  const points = await analytics.getTimeline(user._id, user.timezone, granularity, range);

  sendSuccess(res, { granularity, range, points });
});

export const bySource = asyncHandler(async (req, res) => {
  const user = getAuthenticatedUser(req);

  sendSuccess(res, { sources: await analytics.getBySource(user._id) });
});

export const funnel = asyncHandler(async (req, res) => {
  const user = getAuthenticatedUser(req);

  sendSuccess(res, { stages: await analytics.getFunnel(user._id) });
});

export const topCompanies = asyncHandler(async (req, res) => {
  const user = getAuthenticatedUser(req);
  const { limit } = req.query as unknown as TopCompaniesQuery;

  sendSuccess(res, { companies: await analytics.getTopCompanies(user._id, limit) });
});
