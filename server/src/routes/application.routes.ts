import { Router } from 'express';
import * as applications from '@/controllers/application.controller';
import * as interviews from '@/controllers/interview.controller';
import { csvUpload } from '@/middleware/csvUpload';
import { requireAuth } from '@/middleware/requireAuth';
import { validateBody, validateParams, validateQuery } from '@/middleware/validate';
import {
  applicationIdParams,
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

// Literal paths must be declared before /:id or they would be read as an id.
router.get('/export', validateQuery(exportQuerySchema), applications.exportAll);
router.post('/import', csvUpload, applications.importCsv);
router.post('/bulk', validateBody(bulkActionSchema), applications.bulk);

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

export default router;
