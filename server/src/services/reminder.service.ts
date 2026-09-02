import type { Types } from 'mongoose';
import { Application } from '@/models/Application';
import { Reminder, type ReminderDocument } from '@/models/Reminder';
import type { CreateReminderInput, ListRemindersQuery } from '@/schemas/reminder.schema';
import { ApiError } from '@/utils/ApiError';

/**
 * Reminders for the signed-in account. `unreadOnly` means what the notification
 * bell means by it: has already come due, and has not been acknowledged.
 */
export async function listReminders(
  userId: Types.ObjectId,
  query: ListRemindersQuery,
  now: Date = new Date(),
): Promise<ReminderDocument[]> {
  const filter: Record<string, unknown> = { user: userId };

  if (query.unreadOnly) {
    filter.readAt = null;
    filter.dueAt = { $lte: now };
  }

  return Reminder.find(filter).sort({ dueAt: 1 });
}

export async function createReminder(
  userId: Types.ObjectId,
  input: CreateReminderInput,
): Promise<ReminderDocument> {
  if (input.application) {
    // Scoped by user, so linking a reminder to another account record is a 404
    // rather than a silent cross-account reference.
    const owned = await Application.exists({ _id: input.application, user: userId });

    if (!owned) {
      throw ApiError.notFound('Application not found', 'APPLICATION_NOT_FOUND');
    }
  }

  return Reminder.create({ ...input, user: userId, channel: input.channel ?? 'in_app' });
}

export async function markReminderRead(
  userId: Types.ObjectId,
  id: string,
): Promise<ReminderDocument> {
  const reminder = await Reminder.findOneAndUpdate(
    { _id: id, user: userId },
    { $set: { readAt: new Date() } },
    { new: true },
  );

  if (!reminder) {
    throw ApiError.notFound('Reminder not found', 'REMINDER_NOT_FOUND');
  }

  return reminder;
}

export async function deleteReminder(userId: Types.ObjectId, id: string): Promise<void> {
  const result = await Reminder.deleteOne({ _id: id, user: userId });

  if (result.deletedCount === 0) {
    throw ApiError.notFound('Reminder not found', 'REMINDER_NOT_FOUND');
  }
}
