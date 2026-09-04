import { Router } from 'express';
import * as reminders from '@/controllers/reminder.controller';
import { requireAuth } from '@/middleware/requireAuth';
import { requireVerifiedEmail } from '@/middleware/requireVerifiedEmail';
import { validateBody, validateParams, validateQuery } from '@/middleware/validate';
import {
  createReminderSchema,
  listRemindersQuerySchema,
  reminderIdParams,
} from '@/schemas/reminder.schema';

const router = Router();

router.use(requireAuth);
// Reads stay open for ever; writes close after the seven day grace period.
router.use(requireVerifiedEmail);

router.get('/', validateQuery(listRemindersQuerySchema), reminders.list);
router.post('/', validateBody(createReminderSchema), reminders.create);
router.patch('/:id/read', validateParams(reminderIdParams), reminders.markRead);
router.delete('/:id', validateParams(reminderIdParams), reminders.remove);

export default router;
