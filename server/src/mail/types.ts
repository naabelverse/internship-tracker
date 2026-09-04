/**
 * The message vocabulary. Every email the application can send is one of these
 * six kinds, and each kind carries exactly the data its template needs, so a
 * template can never be rendered with a field the caller forgot to supply.
 */

export const MAIL_KINDS = [
  'verify_email',
  'password_reset',
  'password_changed',
  'account_deleted',
  'reminder_digest',
  'weekly_summary',
] as const;

export type MailKind = (typeof MAIL_KINDS)[number];

/**
 * `security` mail always sends. `optional` mail is subject to the recipient's
 * preferences and carries an unsubscribe link.
 *
 * SPEC section 13 names verification, reset and password-changed as the
 * security-critical set. Account closure is here too: it is the only signal a
 * user gets that their account was destroyed, and suppressing it because a
 * reminder preference is off would hide exactly the event someone whose account
 * was taken over most needs to see.
 */
export type MailCategory = 'security' | 'optional';

export const MAIL_CATEGORY: Record<MailKind, MailCategory> = {
  verify_email: 'security',
  password_reset: 'security',
  password_changed: 'security',
  account_deleted: 'security',
  reminder_digest: 'optional',
  weekly_summary: 'optional',
};

export function isSecurityMail(kind: MailKind): boolean {
  return MAIL_CATEGORY[kind] === 'security';
}

/** The two streams a recipient can leave independently. */
export const UNSUBSCRIBE_CATEGORIES = ['reminders', 'weekly_summary'] as const;
export type UnsubscribeCategory = (typeof UNSUBSCRIBE_CATEGORIES)[number];

export type OptionalMailKind = Extract<MailKind, 'reminder_digest' | 'weekly_summary'>;

/** Which preference switches each optional kind off. */
export const MAIL_UNSUBSCRIBE_CATEGORY: Record<OptionalMailKind, UnsubscribeCategory> = {
  reminder_digest: 'reminders',
  weekly_summary: 'weekly_summary',
};

/** The preference fields the gate reads. A subset of the user document. */
export interface MailRecipient {
  id: string;
  emailRemindersEnabled: boolean;
  weeklySummaryEnabled: boolean;
}

export interface VerifyEmailData {
  name: string;
  verifyUrl: string;
  expiresInHours: number;
  /** A first verification is a welcome; a re-verification after an email change is not. */
  isNewAccount: boolean;
}

export interface PasswordResetData {
  name: string;
  resetUrl: string;
  expiresInMinutes: number;
}

export interface PasswordChangedData {
  name: string;
  /** How the change happened, so the copy can name it. */
  via: 'reset' | 'settings';
}

export interface AccountDeletedData {
  name: string;
  purgeDays: number;
}

export interface DigestItem {
  title: string;
  /** Already formatted in the recipient's own timezone by the caller. */
  dueLabel: string;
  context?: string;
}

export interface ReminderDigestData {
  name: string;
  items: DigestItem[];
}

export interface WeeklySummaryStats {
  created: number;
  applied: number;
  responded: number;
  interviewed: number;
  offers: number;
  responseRate: number;
  currentStreakDays: number;
  weeklyGoalTarget: number;
  weeklyGoalCompleted: number;
}

export interface WeeklySummaryData {
  name: string;
  /** Local calendar bounds of the week being reported, e.g. `1-7 Sep`. */
  weekLabel: string;
  stats: WeeklySummaryStats;
  upcoming: DigestItem[];
}

export type SecurityMessage =
  | { kind: 'verify_email'; data: VerifyEmailData }
  | { kind: 'password_reset'; data: PasswordResetData }
  | { kind: 'password_changed'; data: PasswordChangedData }
  | { kind: 'account_deleted'; data: AccountDeletedData };

export type OptionalMessage =
  | { kind: 'reminder_digest'; data: ReminderDigestData }
  | { kind: 'weekly_summary'; data: WeeklySummaryData };

export type MailMessage = SecurityMessage | OptionalMessage;

export interface RenderedMail {
  subject: string;
  html: string;
  text: string;
  /** `List-Unsubscribe` and friends, set on optional mail only. */
  headers: Record<string, string>;
}
