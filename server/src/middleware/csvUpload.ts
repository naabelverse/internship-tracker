import multer from 'multer';
import { ApiError } from '@/utils/ApiError';

const MAX_CSV_BYTES = 2 * 1024 * 1024;

const ACCEPTED_MIME_TYPES = new Set([
  'text/csv',
  'application/csv',
  'text/plain',
  'application/vnd.ms-excel',
  'application/octet-stream',
]);

/**
 * Buffers a CSV in memory for the import endpoint. Nothing is written to disk:
 * the file is parsed and discarded, so the storage adapter is not involved.
 */
export const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_CSV_BYTES, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (!ACCEPTED_MIME_TYPES.has(file.mimetype)) {
      callback(ApiError.badRequest('Only CSV files can be imported', 'UNSUPPORTED_FILE_TYPE'));
      return;
    }
    callback(null, true);
  },
}).single('file');
