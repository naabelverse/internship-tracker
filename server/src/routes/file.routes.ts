import { Router } from 'express';
import { download } from '@/controllers/file.controller';

const router = Router();

// Deliberately unauthenticated: the expiring signature in the query string is
// the credential, which is what makes the URL shareable with a download manager
// and keeps the contract identical to an S3 presigned link.
router.get('/*', download);

export default router;
