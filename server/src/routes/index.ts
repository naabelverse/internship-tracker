import { Router } from 'express';
import analyticsRouter from '@/routes/analytics.routes';
import applicationRouter from '@/routes/application.routes';
import authRouter from '@/routes/auth.routes';
import calendarRouter from '@/routes/calendar.routes';
import emailRouter from '@/routes/email.routes';
import fileRouter from '@/routes/file.routes';
import healthRouter from '@/routes/health.routes';
import reminderRouter from '@/routes/reminder.routes';

/** Versioned API router mounted at `/api/v1`. */
const router = Router();

router.use(healthRouter);
router.use('/auth', authRouter);
router.use('/applications', applicationRouter);
router.use('/analytics', analyticsRouter);
router.use('/calendar', calendarRouter);
router.use('/reminders', reminderRouter);
router.use('/email', emailRouter);
router.use('/files', fileRouter);

export default router;
