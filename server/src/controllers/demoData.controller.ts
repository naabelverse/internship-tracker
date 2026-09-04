import { getAuthenticatedUser } from '@/middleware/requireAuth';
import * as demoData from '@/services/demoData.service';
import { asyncHandler } from '@/utils/asyncHandler';
import { sendSuccess } from '@/utils/apiResponse';

/**
 * Bridges SPEC section 9's seed data, which is a CLI script, to the dashboard's
 * "Load demo data" button, which runs in a browser against a live account.
 * The service refuses any account that already holds applications.
 */
export const load = asyncHandler(async (req, res) => {
  const user = getAuthenticatedUser(req);

  const inserted = await demoData.loadDemoData(user._id);

  sendSuccess(res, { inserted }, { status: 201, message: 'Demo data loaded' });
});
