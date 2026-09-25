import cron, { type ScheduledTask } from 'node-cron';
import { logger } from '@/config/logger';
import { Application } from '@/models/Application';
import { RefreshToken } from '@/models/RefreshToken';
import { Reminder } from '@/models/Reminder';
import { User } from '@/models/User';
import { attachmentKeysOf, eraseStoredFiles } from '@/services/attachment.service';

/** SPEC section 4: a soft deleted account is purged by a job after 30 days. */
export const PURGE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

export interface PurgeResult {
  users: number;
  applications: number;
  reminders: number;
  refreshTokens: number;
  filesErased: number;
  /** Files storage refused to delete. Each one is logged with its key. */
  filesFailed: number;
}

/**
 * Removes accounts whose 30 day recovery window has closed, together with
 * everything owned by them, uploaded files included.
 *
 * The users are read first and deleted last. If the process dies midway the
 * account still has `deletedAt` set, so it stays invisible and the next run
 * finishes the job; deleting the user first would strand its applications with
 * no owner to find them by.
 *
 * Files are erased after every document is gone, for the reason given on
 * `eraseStoredFiles`. A file storage refuses is logged and skipped, so one
 * failure never holds back the rest of the purge.
 */
export async function purgeDeletedUsers(now = new Date()): Promise<PurgeResult> {
  const cutoff = new Date(now.getTime() - PURGE_AFTER_MS);
  const expired = await User.find({ deletedAt: { $ne: null, $lte: cutoff } }).select('_id');

  if (expired.length === 0) {
    return {
      users: 0,
      applications: 0,
      reminders: 0,
      refreshTokens: 0,
      filesErased: 0,
      filesFailed: 0,
    };
  }

  const ids = expired.map((user) => user._id);
  const owned = await Application.find({ user: { $in: ids } })
    .select('attachments.filename')
    .lean();

  const applications = await Application.deleteMany({ user: { $in: ids } });
  const reminders = await Reminder.deleteMany({ user: { $in: ids } });
  const refreshTokens = await RefreshToken.deleteMany({ user: { $in: ids } });
  const users = await User.deleteMany({ _id: { $in: ids } });
  const files = await eraseStoredFiles(attachmentKeysOf(owned));

  const result = {
    users: users.deletedCount,
    applications: applications.deletedCount,
    reminders: reminders.deletedCount,
    refreshTokens: refreshTokens.deletedCount,
    filesErased: files.erased,
    filesFailed: files.failed,
  };

  logger.info('Purged soft deleted accounts', result);

  return result;
}

/** Runs once a day at 03:15 UTC, off the hour the reminder digest uses. */
export function startPurgeCron(): ScheduledTask {
  return cron.schedule('15 3 * * *', () => {
    void purgeDeletedUsers().catch((error: unknown) => {
      logger.error('Purge job failed', {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
    });
  });
}
