import { getAuthenticatedUser } from '@/middleware/requireAuth';
import * as attachments from '@/services/attachment.service';
import { ApiError } from '@/utils/ApiError';
import { asyncHandler } from '@/utils/asyncHandler';
import { sendSuccess } from '@/utils/apiResponse';

export const upload = asyncHandler(async (req, res) => {
  const user = getAuthenticatedUser(req);

  if (!req.file) {
    throw ApiError.badRequest('A file is required in the file field', 'FILE_REQUIRED');
  }

  const application = await attachments.addAttachment(user._id, req.params.id, req.file);

  sendSuccess(
    res,
    { application: application.toJSON() },
    { status: 201, message: 'Attachment uploaded' },
  );
});

export const link = asyncHandler(async (req, res) => {
  const user = getAuthenticatedUser(req);

  const result = await attachments.getAttachmentLink(
    user._id,
    req.params.id,
    req.params.attachmentId,
  );

  sendSuccess(res, result);
});

export const remove = asyncHandler(async (req, res) => {
  const user = getAuthenticatedUser(req);

  const application = await attachments.removeAttachment(
    user._id,
    req.params.id,
    req.params.attachmentId,
  );

  sendSuccess(res, { application: application.toJSON() }, { message: 'Attachment removed' });
});
