import { Router } from 'express';
import * as applications from '@/controllers/application.controller';
import * as interviews from '@/controllers/interview.controller';
import * as attachments from '@/controllers/attachment.controller';
import * as demoData from '@/controllers/demoData.controller';
import { csvUpload } from '@/middleware/csvUpload';
import { attachmentUpload } from '@/middleware/upload';
import { requireAuth } from '@/middleware/requireAuth';
import { requireVerifiedEmail } from '@/middleware/requireVerifiedEmail';
import { validateBody, validateParams, validateQuery } from '@/middleware/validate';
import {
  applicationIdParams,
  attachmentIdParams,
  bulkActionSchema,
  createApplicationSchema,
  createInterviewSchema,
  exportQuerySchema,
  interviewIdParams,
  listApplicationsQuerySchema,
  statusChangeSchema,
  updateApplicationSchema,
  updateInterviewSchema,
} from '@/schemas/application.schema';

const router = Router();

// Every route below is owner-scoped; the service layer takes the user id and
// filters on it, so there is no unauthenticated path into this resource.
router.use(requireAuth);
// Reads stay open for ever; writes close after the seven day grace period.
router.use(requireVerifiedEmail);

// Literal paths must be declared before /:id or they would be read as an id.
router.get('/export', validateQuery(exportQuerySchema), applications.exportAll);
router.post('/import', csvUpload, applications.importCsv);
router.post('/bulk', validateBody(bulkActionSchema), applications.bulk);
// Fills an empty account with the fixture set behind the dashboard empty state.
// It refuses any account that already holds applications, so it can never mix
// demo rows into a real search.
router.post('/demo-data', demoData.load);

router.get('/', validateQuery(listApplicationsQuerySchema), applications.list);
router.post('/', validateBody(createApplicationSchema), applications.create);

router.get('/:id', validateParams(applicationIdParams), applications.getOne);
router.patch(
  '/:id',
  validateParams(applicationIdParams),
  validateBody(updateApplicationSchema),
  applications.update,
);
router.delete('/:id', validateParams(applicationIdParams), applications.remove);

router.patch(
  '/:id/status',
  validateParams(applicationIdParams),
  validateBody(statusChangeSchema),
  applications.changeStatus,
);

router.post(
  '/:id/interviews',
  validateParams(applicationIdParams),
  validateBody(createInterviewSchema),
  interviews.create,
);
router.patch(
  '/:id/interviews/:interviewId',
  validateParams(interviewIdParams),
  validateBody(updateInterviewSchema),
  interviews.update,
);
router.delete('/:id/interviews/:interviewId', validateParams(interviewIdParams), interviews.remove);

// Attachments are buffered in memory, validated, stripped of image metadata and
// handed to the storage adapter; nothing here touches the local filesystem.
router.post(
  '/:id/attachments',
  validateParams(applicationIdParams),
  attachmentUpload,
  attachments.upload,
);
router.get('/:id/attachments/:attachmentId', validateParams(attachmentIdParams), attachments.link);
router.delete(
  '/:id/attachments/:attachmentId',
  validateParams(attachmentIdParams),
  attachments.remove,
);

export default router;
