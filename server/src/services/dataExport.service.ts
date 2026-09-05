import type { Types } from 'mongoose';
import { APP_NAME, APP_VERSION } from '@/config/app-info';
import { Application } from '@/models/Application';
import { RefreshToken } from '@/models/RefreshToken';
import { Reminder } from '@/models/Reminder';
import { User } from '@/models/User';
import { getAccountUsage, type AccountUsage } from '@/services/usage.service';
import { ApiError } from '@/utils/ApiError';

/**
 * One session as it appears in an export.
 *
 * Metadata only. `tokenHash` is the credential itself and never leaves the
 * server, in an export or anywhere else; what the user is entitled to see is
 * which devices held a session, from where, and when - which is exactly what
 * Settings already shows them.
 */
export interface ExportedSession {
  id: string;
  family: string;
  userAgent?: string;
  ip?: string;
  createdAt: Date;
  expiresAt: Date;
  lastUsedAt?: Date;
  revokedAt?: Date;
  revokedReason?: string;
}

export interface AccountExport {
  meta: {
    application: string;
    version: string;
    exportedAt: string;
    /** What the numbers below are counts of, so a truncated file is detectable. */
    counts: Record<string, number>;
    notes: string[];
  };
  profile: Record<string, unknown>;
  usage: AccountUsage;
  applications: Record<string, unknown>[];
  reminders: Record<string, unknown>[];
  sessions: ExportedSession[];
}

/**
 * The profile, with the credential and token columns removed.
 *
 * `toJSON` already strips the password and both single-use token digests, and
 * this leans on that rather than listing fields again: one allowlist that the
 * API responses and the export share cannot drift apart, whereas two would.
 * `schemaVersion` is deliberately kept - it is what tells a future reader of
 * this file which shape the records are in.
 */
function exportProfile(user: { toJSON: () => Record<string, unknown> }): Record<string, unknown> {
  return user.toJSON();
}

/**
 * Everything the system stores about one account, as a single document.
 *
 * SPEC section 12 requires this to be complete, so it is written against the
 * model list rather than against the screens: User, Application (with its
 * embedded interviews, status history and attachment records), Reminder, and
 * RefreshToken metadata. A model added later without a branch here would leave a
 * gap, which is what `dataExport.test.ts` exists to catch.
 *
 * Attachment *bytes* are not inlined. The records are - filename, size, type,
 * upload time - and the file itself stays behind the signed download URL the
 * detail page already mints. Base64-inlining up to 100 MB of uploads would turn
 * a request meant to answer "what do you know about me" into a memory spike
 * that can take the process down.
 */
export async function exportAccountData(userId: Types.ObjectId): Promise<AccountExport> {
  const user = await User.findOne({ _id: userId, deletedAt: null });

  if (!user) {
    throw ApiError.notFound('Account not found', 'USER_NOT_FOUND');
  }

  const [applications, reminders, sessions, usage] = await Promise.all([
    Application.find({ user: userId }).sort({ createdAt: 1 }),
    Reminder.find({ user: userId }).sort({ dueAt: 1 }),
    RefreshToken.find({ user: userId }).sort({ createdAt: 1 }),
    getAccountUsage(userId),
  ]);

  const interviews = applications.reduce((total, row) => total + row.interviews.length, 0);
  const attachments = applications.reduce((total, row) => total + row.attachments.length, 0);

  return {
    meta: {
      application: APP_NAME,
      version: APP_VERSION,
      exportedAt: new Date().toISOString(),
      counts: {
        applications: applications.length,
        interviews,
        attachments,
        reminders: reminders.length,
        sessions: sessions.length,
      },
      notes: [
        'Every timestamp is UTC in ISO 8601. Render them in your own timezone, recorded as profile.timezone.',
        'Attachment records list what was uploaded; download the files themselves from the application detail page.',
        'Password hashes, refresh token hashes and single-use email token hashes are deliberately excluded: they are credentials, not your data.',
      ],
    },
    profile: exportProfile(user),
    usage,
    // `toJSON` surfaces embedded interviews, status history and attachment
    // records along with the parent, which is why they need no branch of
    // their own here.
    applications: applications.map((application) => application.toJSON()),
    reminders: reminders.map((reminder) => reminder.toJSON()),
    sessions: sessions.map((token) => ({
      id: token._id.toString(),
      family: token.family,
      userAgent: token.userAgent,
      ip: token.ip,
      createdAt: token.createdAt,
      expiresAt: token.expiresAt,
      lastUsedAt: token.lastUsedAt,
      revokedAt: token.revokedAt,
      revokedReason: token.revokedReason,
    })),
  };
}

/** The filename the browser saves the export as. */
export function exportFilename(now: Date = new Date()): string {
  return `internship-tracker-export-${now.toISOString().slice(0, 10)}.json`;
}
