import { Router } from 'express';
import applicationRouter from '@/routes/application.routes';
import authRouter from '@/routes/auth.routes';
import healthRouter from '@/routes/health.routes';

/** Versioned API router mounted at `/api/v1`. */
const router = Router();

router.use(healthRouter);
router.use('/auth', authRouter);
router.use('/applications', applicationRouter);

export default router;
