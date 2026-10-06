import { getAuthenticatedUser } from '@/middleware/requireAuth';
import type {
  BulkActionInput,
  CreateApplicationInput,
  ExportQuery,
  ListApplicationsQuery,
  StatusChangeInput,
  UpdateApplicationInput,
} from '@/schemas/application.schema';
import * as applications from '@/services/application.service';
import { exportApplications, importApplications } from '@/services/applicationTransfer.service';
import { ApiError } from '@/utils/ApiError';
import { asyncHandler } from '@/utils/asyncHandler';
import { sendSuccess } from '@/utils/apiResponse';

export const list = asyncHandler(async (req, res) => {
  const user = getAuthenticatedUser(req);
  const query = req.query as unknown as ListApplicationsQuery;

  const { items, meta } = await applications.listApplications(user._id, query);

  sendSuccess(res, { applications: items.map((application) => application.toJSON()) }, { meta });
});

export const create = asyncHandler(async (req, res) => {
  const user = getAuthenticatedUser(req);

  const application = await applications.createApplication(
    user._id,
    req.body as CreateApplicationInput,
  );

  sendSuccess(
    res,
    { application: application.toJSON() },
    { status: 201, message: 'Application created' },
  );
});

export const getOne = asyncHandler(async (req, res) => {
  const user = getAuthenticatedUser(req);

  const application = await applications.getApplication(user._id, req.params.id);

  sendSuccess(res, { application: application.toJSON() });
});

export const update = asyncHandler(async (req, res) => {
  const user = getAuthenticatedUser(req);

  const application = await applications.updateApplication(
    user._id,
    req.params.id,
    req.body as UpdateApplicationInput,
  );

  sendSuccess(res, { application: application.toJSON() }, { message: 'Application updated' });
});

export const remove = asyncHandler(async (req, res) => {
  const user = getAuthenticatedUser(req);

  await applications.deleteApplication(user._id, req.params.id);

  sendSuccess(res, { deleted: true }, { message: 'Application deleted' });
});

export const changeStatus = asyncHandler(async (req, res) => {
  const user = getAuthenticatedUser(req);

  const application = await applications.changeStatus(
    user._id,
    req.params.id,
    req.body as StatusChangeInput,
  );

  sendSuccess(res, { application: application.toJSON() }, { message: 'Status updated' });
});

export const bulk = asyncHandler(async (req, res) => {
  const user = getAuthenticatedUser(req);

  const result = await applications.bulkAction(user._id, req.body as BulkActionInput);

  sendSuccess(res, result, { message: `Updated ${String(result.modified)} applications` });
});

export const exportAll = asyncHandler(async (req, res) => {
  const user = getAuthenticatedUser(req);
  const { format, columns } = req.query as unknown as ExportQuery;

  const result = await exportApplications(user._id, format, columns);

  // A download, so the raw file is the body rather than the JSON envelope.
  res.setHeader('Content-Type', result.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
  res.send(result.body);
});

export const importCsv = asyncHandler(async (req, res) => {
  const user = getAuthenticatedUser(req);

  if (!req.file) {
    throw ApiError.badRequest('A CSV file is required in the file field', 'FILE_REQUIRED');
  }

  const result = await importApplications(user._id, req.file.buffer.toString('utf8'));

  sendSuccess(res, result, { message: `Imported ${String(result.imported)} applications` });
});
