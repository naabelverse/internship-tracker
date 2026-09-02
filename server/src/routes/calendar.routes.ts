import { Router } from 'express';
import { calendar } from '@/controllers/reminder.controller';
import { requireAuth } from '@/middleware/requireAuth';
import { validateQuery } from '@/middleware/validate';
import { calendarQuerySchema } from '@/schemas/reminder.schema';

const router = Router();

router.use(requireAuth);

router.get('/', validateQuery(calendarQuerySchema), calendar);

export default router;
