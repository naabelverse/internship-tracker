import { Router } from 'express';
import authRouter from '@/routes/auth.routes';
import healthRouter from '@/routes/health.routes';

/** Versioned API router mounted at `/api/v1`. */
const router = Router();

router.use(healthRouter);
router.use('/auth', authRouter);

export default router;
