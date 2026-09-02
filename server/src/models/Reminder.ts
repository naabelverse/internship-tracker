import { Schema, model, type HydratedDocument, type Model, type Types } from 'mongoose';

export const REMINDER_TYPES = ['deadline', 'interview', 'followup', 'custom'] as const;
export const REMINDER_CHANNELS = ['in_app', 'email'] as const;

export type ReminderType = (typeof REMINDER_TYPES)[number];
export type ReminderChannel = (typeof REMINDER_CHANNELS)[number];

export interface ReminderAttributes {
  user: Types.ObjectId;
  application?: Types.ObjectId;
  type: ReminderType;
  title: string;
  dueAt: Date;
  sent: boolean;
  sentAt?: Date;
  readAt?: Date;
  channel: ReminderChannel;
  createdAt: Date;
  updatedAt: Date;
}

export type ReminderModelType = Model<ReminderAttributes>;
export type ReminderDocument = HydratedDocument<ReminderAttributes>;

const reminderSchema = new Schema<ReminderAttributes, ReminderModelType>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    application: { type: Schema.Types.ObjectId, ref: 'Application' },
    type: { type: String, enum: REMINDER_TYPES, required: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    dueAt: { type: Date, required: true },
    sent: { type: Boolean, default: false },
    sentAt: { type: Date },
    readAt: { type: Date, default: null },
    channel: { type: String, enum: REMINDER_CHANNELS, default: 'in_app' },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_document, record: Record<string, unknown>) => {
        record.id = record._id;
        delete record._id;
        delete record.__v;
        return record;
      },
    },
  },
);

// The notification bell asks for due and unacknowledged reminders.
reminderSchema.index({ user: 1, dueAt: 1 });
reminderSchema.index({ user: 1, readAt: 1, dueAt: 1 });
// The cron sweeps unsent reminders that have come due, across all users.
reminderSchema.index({ sent: 1, dueAt: 1 });

export const Reminder = model<ReminderAttributes, ReminderModelType>('Reminder', reminderSchema);
