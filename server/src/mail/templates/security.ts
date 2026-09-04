import { APP_PRODUCT_NAME } from '@/config/app-info';
import type { MailBlock } from '@/mail/layout';
import type {
  AccountDeletedData,
  PasswordChangedData,
  PasswordResetData,
  VerifyEmailData,
} from '@/mail/types';

/**
 * The four security-critical templates. None of them carries an unsubscribe
 * link, and none of them is subject to a preference: a person who cannot receive
 * these cannot verify an address, recover an account, or find out that either
 * was taken from them.
 *
 * A template produces content, never a shell. The layout is applied by the
 * registry, which is what keeps the masthead, the footer and the plain-text
 * projection identical across all six.
 */

export interface TemplateOutput {
  subject: string;
  heading: string;
  /** The preview line an inbox shows beside the subject. */
  preheader: string;
  blocks: MailBlock[];
}

function greeting(name: string): MailBlock {
  return { type: 'paragraph', text: `Hi ${name},` };
}

export function verifyEmailTemplate(data: VerifyEmailData): TemplateOutput {
  const heading = data.isNewAccount
    ? `Welcome to ${APP_PRODUCT_NAME}`
    : 'Confirm your new email address';

  const opening = data.isNewAccount
    ? `Your account is ready. Confirm this address and the whole of ${APP_PRODUCT_NAME} is yours — the board, the calendar, deadline reminders and your weekly stats.`
    : 'You asked to move your account to this address. Confirm it and it becomes the address you sign in with.';

  return {
    subject: data.isNewAccount
      ? `Confirm your email to finish setting up ${APP_PRODUCT_NAME}`
      : 'Confirm your new email address',
    heading,
    preheader: `The link expires in ${String(data.expiresInHours)} hours.`,
    blocks: [
      greeting(data.name),
      { type: 'paragraph', text: opening },
      { type: 'button', label: 'Confirm my email address', url: data.verifyUrl },
      {
        type: 'note',
        text: `This link works once and expires in ${String(data.expiresInHours)} hours. Until you confirm it, your old address stays the one that signs in.`,
      },
    ],
  };
}

export function passwordResetTemplate(data: PasswordResetData): TemplateOutput {
  return {
    subject: 'Reset your password',
    heading: 'Reset your password',
    preheader: `The link expires in ${String(data.expiresInMinutes)} minutes.`,
    blocks: [
      greeting(data.name),
      {
        type: 'paragraph',
        text: 'Someone asked to reset the password on your account. If that was you, choose a new one here.',
      },
      { type: 'button', label: 'Choose a new password', url: data.resetUrl },
      {
        type: 'note',
        text: `This link works once and expires in ${String(data.expiresInMinutes)} minutes. If it was not you, nothing has changed and you can ignore this message — your password is still the one you set.`,
      },
    ],
  };
}

export function passwordChangedTemplate(data: PasswordChangedData): TemplateOutput {
  const how =
    data.via === 'reset'
      ? 'The password on your account was just reset from a reset link.'
      : 'The password on your account was just changed from your settings.';

  return {
    subject: 'Your password was changed',
    heading: 'Your password was changed',
    preheader: 'Every signed-in device was signed out.',
    blocks: [
      greeting(data.name),
      { type: 'paragraph', text: `${how} Every signed-in device has been signed out.` },
      {
        type: 'paragraph',
        text: 'If this was you, there is nothing else to do — sign back in with the new password.',
      },
      {
        type: 'note',
        text: 'If this was not you, reset your password immediately and get in touch. Whoever made the change has been signed out too.',
      },
    ],
  };
}

export function accountDeletedTemplate(data: AccountDeletedData): TemplateOutput {
  const days = String(data.purgeDays);

  return {
    subject: 'Your account has been closed',
    heading: 'Your account has been closed',
    preheader: `Your data is kept for ${days} days, then permanently removed.`,
    blocks: [
      greeting(data.name),
      {
        type: 'paragraph',
        text: 'Your account is closed and you have been signed out everywhere. Thanks for using it while you did — good luck with the search.',
      },
      {
        type: 'paragraph',
        text: `Your applications, interviews and files are kept for ${days} days and then permanently removed. Nothing is recoverable after that.`,
      },
      {
        type: 'note',
        text: `If you did not close this account, get in touch within those ${days} days. Once the data is purged there is nothing left to restore.`,
      },
    ],
  };
}
