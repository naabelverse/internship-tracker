import { Types } from 'mongoose';
import { z } from 'zod';
import { REMINDER_CHANNELS, REMINDER_TYPES } from '@/models/Reminder';

const objectId = z.string().refine((value) => Types.ObjectId.isValid(value), 'must be a valid id');

export const createReminderSchema = z
  .object({
    application: objectId.optional(),
    type: z.enum(REMINDER_TYPES),
    title: z.string().trim().min(1, 'is required').max(200),
    dueAt: z.coerce.date(),
    channel: z.enum(REMINDER_CHANNELS).optional(),
  })
  .strict();

export const listRemindersQuerySchema = z
  .object({
    unreadOnly: z.preprocess(
      (value) => (value === undefined ? undefined : value === true || value === 'true'),
      z.boolean().optional(),
    ),
  })
  .strict();

export const reminderIdParams = z.object({ id: objectId }).strict();

export const calendarQuerySchema = z
  .object({
    from: z.coerce.date(),
    to: z.coerce.date(),
  })
  .strict()
  .refine((value) => value.from <= value.to, 'from must not be after to');

export type CreateReminderInput = z.infer<typeof createReminderSchema>;
export type ListRemindersQuery = z.infer<typeof listRemindersQuerySchema>;
export type CalendarQuery = z.infer<typeof calendarQuerySchema>;
