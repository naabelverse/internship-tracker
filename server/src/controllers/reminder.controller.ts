import { getAuthenticatedUser } from '@/middleware/requireAuth';
import type {
  CalendarQuery,
  CreateReminderInput,
  ListRemindersQuery,
} from '@/schemas/reminder.schema';
import { getCalendar } from '@/services/calendar.service';
import * as reminders from '@/services/reminder.service';
import { asyncHandler } from '@/utils/asyncHandler';
import { sendSuccess } from '@/utils/apiResponse';

export const list = asyncHandler(async (req, res) => {
  const user = getAuthenticatedUser(req);
  const query = req.query as unknown as ListRemindersQuery;

  const found = await reminders.listReminders(user._id, query);

  sendSuccess(res, { reminders: found.map((reminder) => reminder.toJSON()) });
});

export const create = asyncHandler(async (req, res) => {
  const user = getAuthenticatedUser(req);

  const reminder = await reminders.createReminder(user._id, req.body as CreateReminderInput);

  sendSuccess(res, { reminder: reminder.toJSON() }, { status: 201, message: 'Reminder created' });
});

export const markRead = asyncHandler(async (req, res) => {
  const user = getAuthenticatedUser(req);

  const reminder = await reminders.markReminderRead(user._id, req.params.id);

  sendSuccess(res, { reminder: reminder.toJSON() }, { message: 'Reminder marked as read' });
});

export const remove = asyncHandler(async (req, res) => {
  const user = getAuthenticatedUser(req);

  await reminders.deleteReminder(user._id, req.params.id);

  sendSuccess(res, { deleted: true }, { message: 'Reminder deleted' });
});

export const calendar = asyncHandler(async (req, res) => {
  const user = getAuthenticatedUser(req);
  const { from, to } = req.query as unknown as CalendarQuery;

  const events = await getCalendar(user._id, from, to);

  sendSuccess(res, { events });
});
