import type { Types } from 'mongoose';
import { FEEDBACK_INBOX } from '@/config/app-info';
import { User } from '@/models/User';
import type { FeedbackInput } from '@/schemas/email.schema';
import { sendMail } from '@/services/mailer.service';
import { ApiError } from '@/utils/ApiError';

/**
 * Mails the maintainer one piece of feedback. Nothing is stored: the inbox is
 * the record, and a reply address, when given, rides as Reply-To.
 */
export async function sendFeedback(userId: Types.ObjectId, input: FeedbackInput): Promise<void> {
  const user = await User.findOne({ _id: userId, deletedAt: null }).select('name email');

  if (!user) throw ApiError.notFound('Account not found', 'USER_NOT_FOUND');

  const replyTo = input.replyTo || undefined;

  sendMail({
    to: FEEDBACK_INBOX,
    message: {
      kind: 'feedback',
      data: {
        category: input.category,
        message: input.message,
        senderName: user.name,
        senderAccountEmail: user.email,
        replyTo,
      },
    },
    replyTo,
  });
}
