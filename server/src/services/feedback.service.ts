import type { Types } from 'mongoose';
import { FEEDBACK_INBOX } from '@/config/app-info';
import { User } from '@/models/User';
import type { FeedbackInput } from '@/schemas/email.schema';
import { sendMail } from '@/services/mailer.service';
import { ApiError } from '@/utils/ApiError';

/**
 * Mails the maintainer one piece of feedback. Nothing is stored: the inbox is
 * the record, and the account's email rides as Reply-To.
 *
 * The shared demo account gets no Reply-To: its address is not anyone's inbox,
 * and a reply sent there could reach whoever owns that domain.
 */
export async function sendFeedback(userId: Types.ObjectId, input: FeedbackInput): Promise<void> {
  const user = await User.findOne({ _id: userId, deletedAt: null }).select('name email isDemo');

  if (!user) throw ApiError.notFound('Account not found', 'USER_NOT_FOUND');

  const replyTo = user.isDemo ? undefined : user.email;

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
