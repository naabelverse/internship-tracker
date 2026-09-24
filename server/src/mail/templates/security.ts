import { APP_PRODUCT_NAME } from '@/config/app-info';
import type { MailBlock } from '@/mail/layout';
import type {
  AccountDeletedData,
  AccountRestoredData,
  PasswordChangedData,
  PasswordResetData,
  VerifyEmailData,
} from '@/mail/types';

/**
 * The five security-critical templates. None of them carries an unsubscribe
 * link, and none of them is subject to a preference: a person who cannot receive
 * these cannot verify an address, recover an account, or find out that either
 * was taken from them.
 *
 * A template produces content, never a shell. The layout is applied by the
 * registry, which is what keeps the masthead, the footer and the plain-text
 * projection identical across all seven.
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

/**
 * Files are named as the exception on purpose: the purge does not yet erase
 * them from storage (issue #34), so saying "everything is removed" would be the
 * claim this email used to make and could not keep.
 */
export function accountDeletedTemplate(data: AccountDeletedData): TemplateOutput {
  const date = data.purgeDate;

  return {
    subject: 'Your account has been closed',
    heading: 'Your account has been closed',
    preheader: `Your account can be restored until ${date}, then it is permanently removed.`,
    blocks: [
      greeting(data.name),
      {
        type: 'paragraph',
        text: 'Your account is closed and you have been signed out everywhere. Thanks for using it while you did — good luck with the search.',
      },
      {
        type: 'paragraph',
        text: `Your applications, interviews, notes and reminders are kept until ${date} and then permanently removed. Uploaded files are not removed at that point yet: they stay in storage, no longer linked to any account. To make sure a file is gone, restore the account, delete the file from its application, then close the account again.`,
      },
      {
        type: 'note',
        text: `Changed your mind? Sign in before ${date} to restore your account. Password reset won't work on a closed account, so you'll need your current password. If you did not close this account yourself, restore it the same way and then change your password.`,
      },
    ],
  };
}

export function accountRestoredTemplate(data: AccountRestoredData): TemplateOutput {
  return {
    subject: 'Your account has been restored',
    heading: 'Your account has been restored',
    preheader: 'Your account is open again, with your data as you left it.',
    blocks: [
      greeting(data.name),
      {
        type: 'paragraph',
        text: 'Your account has been restored and you are signed in on the device you used. Your applications, interviews, notes, files and reminders are back as you left them. Reminders that came due while the account was closed will not be sent.',
      },
      {
        type: 'note',
        text: 'If this was not you, change your password now. Devices that were signed in before the account was closed stay signed out.',
      },
    ],
  };
}
