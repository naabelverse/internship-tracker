import { getHealthReport, getReadinessReport } from '@/services/health.service';
import { ApiError } from '@/utils/ApiError';
import { asyncHandler } from '@/utils/asyncHandler';
import { sendSuccess } from '@/utils/apiResponse';

export const getHealth = asyncHandler(async (_req, res) => {
  sendSuccess(res, getHealthReport());
});

export const getReadiness = asyncHandler(async (_req, res) => {
  const report = await getReadinessReport();

  if (!report.ready) {
    throw ApiError.serviceUnavailable('Service is not ready', 'NOT_READY', report.checks);
  }

  sendSuccess(res, report);
});
