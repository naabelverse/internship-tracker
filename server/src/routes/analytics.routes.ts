import { Router } from 'express';
import * as analytics from '@/controllers/analytics.controller';
import { requireAuth } from '@/middleware/requireAuth';
import { validateQuery } from '@/middleware/validate';
import {
  summaryQuerySchema,
  timelineQuerySchema,
  topCompaniesQuerySchema,
} from '@/schemas/analytics.schema';

const router = Router();

router.use(requireAuth);

router.get('/summary', validateQuery(summaryQuerySchema), analytics.summary);
router.get('/status-breakdown', analytics.statusBreakdown);
router.get('/timeline', validateQuery(timelineQuerySchema), analytics.timeline);
router.get('/by-source', analytics.bySource);
router.get('/funnel', analytics.funnel);
router.get('/top-companies', validateQuery(topCompaniesQuerySchema), analytics.topCompanies);

export default router;
