import { getStorage } from '@/storage';
import { verifyDownload } from '@/storage/signing';
import { ApiError } from '@/utils/ApiError';
import { asyncHandler } from '@/utils/asyncHandler';

/**
 * Serves a locally stored object against a signed, expiring URL. The signature
 * is the only credential, so an invalid or expired one yields the same 404 as a
 * missing key and cannot be used to probe for what exists.
 */
export const download = asyncHandler(async (req, res) => {
  const key = req.params[0] ?? '';
  const expiresAt = Number(req.query.expires);
  const signature = typeof req.query.signature === 'string' ? req.query.signature : '';
  const downloadName = typeof req.query.name === 'string' ? req.query.name : 'download';

  if (!verifyDownload(key, expiresAt, signature)) {
    throw ApiError.notFound('File not found', 'FILE_NOT_FOUND');
  }

  const body = await getStorage().get(key);

  // Always an attachment, never inline: a stored PDF or image must not be able
  // to execute in the context of this origin.
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${encodeURIComponent(downloadName)}"`,
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(body);
});
