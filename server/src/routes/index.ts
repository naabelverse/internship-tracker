import { Router } from 'express';
import healthRouter from '@/routes/health.routes';

/** Versioned API router mounted at `/api/v1`. */
const router = Router();

router.use(healthRouter);

export default router;
