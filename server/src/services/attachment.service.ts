import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Types } from 'mongoose';
import { logger } from '@/config/logger';
import { Application, type ApplicationDocument } from '@/models/Application';
import { getStorage, type StorageAdapter } from '@/storage';
import { assertAttachmentCapacity } from '@/services/usage.service';
import { DEFAULT_SIGNED_URL_TTL_SECONDS } from '@/storage/StorageAdapter';
import { ApiError } from '@/utils/ApiError';
import { stripImageMetadata } from '@/utils/images';

/** SPEC section 5: pdf, doc, docx, png and jpg only. */
export const ALLOWED_ATTACHMENT_TYPES: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'image/png': 'png',
  'image/jpeg': 'jpg',
};

export interface UploadedFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

async function loadOwned(userId: Types.ObjectId, id: string): Promise<ApplicationDocument> {
  const application = await Application.findOne({ _id: id, user: userId });

  if (!application) {
    throw ApiError.notFound('Application not found', 'APPLICATION_NOT_FOUND');
  }

  return application;
}

/**
 * A generated, non-guessable key. The name the user chose is kept only as a
 * display label; it never reaches the filesystem or the bucket, so a crafted
 * filename cannot traverse paths or collide with someone else upload.
 */
function buildStorageKey(userId: Types.ObjectId, applicationId: string, mimeType: string): string {
  const extension = ALLOWED_ATTACHMENT_TYPES[mimeType];
  return `attachments/${userId.toString()}/${applicationId}/${randomUUID()}.${extension}`;
}

export async function addAttachment(
  userId: Types.ObjectId,
  applicationId: string,
  file: UploadedFile,
): Promise<ApplicationDocument> {
  if (!ALLOWED_ATTACHMENT_TYPES[file.mimetype]) {
    throw ApiError.badRequest(
      'Only PDF, DOC, DOCX, PNG and JPG files can be attached',
      'UNSUPPORTED_FILE_TYPE',
    );
  }

  const application = await loadOwned(userId, applicationId);
  const body = await stripImageMetadata(file.buffer, file.mimetype);

  // Measured after stripping, because that is what actually gets stored and
  // therefore what the account should be charged for. Checked before the put, so
  // a refused upload never leaves an orphan in the bucket.
  await assertAttachmentCapacity(userId, application, body.length);

  const key = buildStorageKey(userId, applicationId, file.mimetype);

  await getStorage().put({ key, body, contentType: file.mimetype });

  application.attachments.push({
    filename: key,
    // Kept for display only, and stripped of any directory component.
    originalName: path.basename(file.originalname).slice(0, 255),
    mimeType: file.mimetype,
    size: body.length,
    url: `/api/v1/applications/${applicationId}/attachments`,
    uploadedAt: new Date(),
  });

  await application.save();

  return application;
}

function requireAttachmentIndex(application: ApplicationDocument, attachmentId: string): number {
  const index = application.attachments.findIndex(
    (attachment) => attachment._id.toString() === attachmentId,
  );

  if (index === -1) {
    throw ApiError.notFound('Attachment not found', 'ATTACHMENT_NOT_FOUND');
  }

  return index;
}

export interface AttachmentLink {
  url: string;
  expiresInSeconds: number;
  filename: string;
}

/** Minted fresh on every request, because a stored URL would outlive its signature. */
export async function getAttachmentLink(
  userId: Types.ObjectId,
  applicationId: string,
  attachmentId: string,
): Promise<AttachmentLink> {
  const application = await loadOwned(userId, applicationId);
  const attachment = application.attachments[requireAttachmentIndex(application, attachmentId)];

  const url = await getStorage().signedUrl(attachment.filename, {
    expiresInSeconds: DEFAULT_SIGNED_URL_TTL_SECONDS,
    downloadName: attachment.originalName,
  });

  return {
    url,
    expiresInSeconds: DEFAULT_SIGNED_URL_TTL_SECONDS,
    filename: attachment.originalName,
  };
}

export async function removeAttachment(
  userId: Types.ObjectId,
  applicationId: string,
  attachmentId: string,
): Promise<ApplicationDocument> {
  const application = await loadOwned(userId, applicationId);
  const index = requireAttachmentIndex(application, attachmentId);
  const [removed] = application.attachments.splice(index, 1);

  await application.save();
  // Deleted after the document is saved: an orphaned object is recoverable,
  // a document pointing at bytes that are gone is not.
  await getStorage().delete(removed.filename);

  return application;
}

/** Storage keys of every attachment on the given applications, read before they are deleted. */
export function attachmentKeysOf(
  applications: { attachments: { filename: string }[] }[],
): string[] {
  return applications.flatMap((application) =>
    application.attachments.map((attachment) => attachment.filename),
  );
}

export interface FileErasureResult {
  erased: number;
  failed: number;
}

/** Enough to finish a purge quickly without opening hundreds of storage requests at once. */
const ERASE_BATCH_SIZE = 20;

/**
 * Erases the stored files of applications that have already been deleted.
 *
 * Callers delete the documents first and pass the keys they read beforehand,
 * the same order `removeAttachment` uses: a crash or a storage outage in
 * between can only leave an orphaned object, never a record pointing at bytes
 * that are gone. For the same reason this never throws. The documents are
 * already deleted, so a failed file is logged with its key, for manual removal,
 * and the remaining files are still erased.
 */
export async function eraseStoredFiles(
  keys: string[],
  storage: StorageAdapter = getStorage(),
): Promise<FileErasureResult> {
  let failed = 0;

  for (let start = 0; start < keys.length; start += ERASE_BATCH_SIZE) {
    const batch = keys.slice(start, start + ERASE_BATCH_SIZE);
    const outcomes = await Promise.allSettled(batch.map((key) => storage.delete(key)));

    outcomes.forEach((outcome, index) => {
      if (outcome.status === 'fulfilled') return;

      failed += 1;
      logger.error('Stored file could not be erased', {
        key: batch[index],
        reason: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
      });
    });
  }

  return { erased: keys.length - failed, failed };
}
