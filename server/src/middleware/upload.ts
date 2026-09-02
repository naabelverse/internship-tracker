import multer from 'multer';
import { env } from '@/config/env';
import { ALLOWED_ATTACHMENT_TYPES } from '@/services/attachment.service';
import { ApiError } from '@/utils/ApiError';

/**
 * Buffers an attachment in memory so it can be validated and, for images,
 * re-encoded to strip EXIF before anything is handed to the storage adapter.
 * Nothing is written to disk on the way through, which is what keeps the
 * production path free of the ephemeral filesystem.
 */
export const attachmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
  fileFilter: (_request, file, callback) => {
    if (!ALLOWED_ATTACHMENT_TYPES[file.mimetype]) {
      callback(
        ApiError.badRequest(
          'Only PDF, DOC, DOCX, PNG and JPG files can be attached',
          'UNSUPPORTED_FILE_TYPE',
        ),
      );
      return;
    }

    callback(null, true);
  },
}).single('file');
