import type { Types } from 'mongoose';
import {
  MAX_APPLICATIONS_PER_ACCOUNT,
  MAX_ATTACHMENTS_PER_APPLICATION,
  MAX_TOTAL_UPLOAD_BYTES,
  formatMegabytes,
} from '@/config/limits';
import { Application, type ApplicationDocument } from '@/models/Application';
import { ApiError } from '@/utils/ApiError';

export interface UsageCounter {
  used: number;
  limit: number;
  remaining: number;
}

export interface AccountUsage {
  applications: UsageCounter;
  /** Bytes, so the client decides how to render them rather than parsing prose. */
  storageBytes: UsageCounter;
  attachmentsPerApplication: { limit: number };
}

function counter(used: number, limit: number): UsageCounter {
  return { used, limit, remaining: Math.max(0, limit - used) };
}

/**
 * Total bytes this account has stored, summed from the attachment subdocuments
 * rather than from the bucket.
 *
 * The stored `size` is the size of what was actually written - `addAttachment`
 * records `body.length` after EXIF stripping, not the size multer received - so
 * this matches what the object store holds.
 */
async function totalStoredBytes(userId: Types.ObjectId): Promise<number> {
  const [result] = await Application.aggregate<{ bytes: number }>([
    { $match: { user: userId } },
    { $unwind: '$attachments' },
    { $group: { _id: null, bytes: { $sum: '$attachments.size' } } },
    { $project: { _id: 0, bytes: 1 } },
  ]);

  return result?.bytes ?? 0;
}

/** Everything Settings needs to show the account against its ceilings. */
export async function getAccountUsage(userId: Types.ObjectId): Promise<AccountUsage> {
  const [applications, storageBytes] = await Promise.all([
    Application.countDocuments({ user: userId }),
    totalStoredBytes(userId),
  ]);

  return {
    applications: counter(applications, MAX_APPLICATIONS_PER_ACCOUNT),
    storageBytes: counter(storageBytes, MAX_TOTAL_UPLOAD_BYTES),
    attachmentsPerApplication: { limit: MAX_ATTACHMENTS_PER_APPLICATION },
  };
}

/**
 * Refuses a write that would take the account past its application ceiling.
 *
 * 403 rather than 429: the account is not going too fast, it is full, and
 * waiting will not help. `incoming` is more than one for a CSV import, which has
 * to be rejected as a whole rather than filling the last few slots and failing
 * silently on the rest.
 */
export async function assertApplicationCapacity(
  userId: Types.ObjectId,
  incoming = 1,
): Promise<void> {
  const used = await Application.countDocuments({ user: userId });

  if (used + incoming <= MAX_APPLICATIONS_PER_ACCOUNT) return;

  const limit = String(MAX_APPLICATIONS_PER_ACCOUNT);
  const remaining = String(Math.max(0, MAX_APPLICATIONS_PER_ACCOUNT - used));

  throw ApiError.forbidden(
    incoming === 1
      ? `You have reached the limit of ${limit} applications. Delete some to add more.`
      : `That import would take you past the limit of ${limit} applications. You have room for ${remaining} more.`,
    'APPLICATION_LIMIT_REACHED',
  );
}

/**
 * Refuses an attachment that would breach either upload ceiling.
 *
 * `incomingBytes` is the size of the body about to be stored, so the caller must
 * strip metadata before asking - otherwise the account is charged for bytes that
 * were never written.
 */
export async function assertAttachmentCapacity(
  userId: Types.ObjectId,
  application: ApplicationDocument,
  incomingBytes: number,
): Promise<void> {
  if (application.attachments.length >= MAX_ATTACHMENTS_PER_APPLICATION) {
    throw ApiError.forbidden(
      `This application already has the maximum of ${String(MAX_ATTACHMENTS_PER_APPLICATION)} attachments.`,
      'ATTACHMENT_LIMIT_REACHED',
    );
  }

  const used = await totalStoredBytes(userId);

  if (used + incomingBytes <= MAX_TOTAL_UPLOAD_BYTES) return;

  throw ApiError.forbidden(
    `That file would take you past your ${formatMegabytes(MAX_TOTAL_UPLOAD_BYTES)} upload allowance. ` +
      `You are using ${formatMegabytes(used)}. Remove some attachments to free up space.`,
    'STORAGE_LIMIT_REACHED',
  );
}
