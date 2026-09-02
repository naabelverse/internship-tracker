import { getAuthenticatedUser } from '@/middleware/requireAuth';
import type { CreateInterviewInput, UpdateInterviewInput } from '@/schemas/application.schema';
import * as interviews from '@/services/interview.service';
import { asyncHandler } from '@/utils/asyncHandler';
import { sendSuccess } from '@/utils/apiResponse';

export const create = asyncHandler(async (req, res) => {
  const user = getAuthenticatedUser(req);

  const application = await interviews.addInterview(
    user._id,
    req.params.id,
    req.body as CreateInterviewInput,
  );

  sendSuccess(
    res,
    { application: application.toJSON() },
    { status: 201, message: 'Interview added' },
  );
});

export const update = asyncHandler(async (req, res) => {
  const user = getAuthenticatedUser(req);

  const application = await interviews.updateInterview(
    user._id,
    req.params.id,
    req.params.interviewId,
    req.body as UpdateInterviewInput,
  );

  sendSuccess(res, { application: application.toJSON() }, { message: 'Interview updated' });
});

export const remove = asyncHandler(async (req, res) => {
  const user = getAuthenticatedUser(req);

  const application = await interviews.removeInterview(
    user._id,
    req.params.id,
    req.params.interviewId,
  );

  sendSuccess(res, { application: application.toJSON() }, { message: 'Interview removed' });
});
