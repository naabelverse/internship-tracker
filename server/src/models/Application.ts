import { Schema, model, type HydratedDocument, type Model, type Types } from 'mongoose';

export const APPLICATION_STATUSES = [
  'saved',
  'applied',
  'assessment',
  'interview',
  'offer',
  'rejected',
  'ghosted',
  'withdrawn',
] as const;
export const WORK_MODES = ['remote', 'hybrid', 'onsite'] as const;
export const EMPLOYMENT_TYPES = ['internship', 'part-time', 'full-time'] as const;
export const PRIORITIES = ['low', 'medium', 'high'] as const;
export const SOURCES = [
  'jobstreet',
  'linkedin',
  'indeed',
  'hiredly',
  'maukerja',
  'myfuturejobs',
  'company_site',
  'referral',
  'career_fair',
  'other',
] as const;

/**
 * Sources the API no longer accepts, each with the text migration 002 moves into
 * `sourceOther` when it rewrites the row to `other`. The model still accepts
 * them so a stored row stays saveable if a deploy ever lands before that
 * migration has run: every save re-validates the paths it loaded, so dropping a
 * value here would make each such row fail on its next status change.
 */
export const LEGACY_SOURCE_LABELS = { internshala: 'Internshala' } as const;
export type LegacySource = keyof typeof LEGACY_SOURCE_LABELS;

/** The free-text "Other: please specify" field, sized for a platform or event name. */
export const MAX_SOURCE_OTHER_LENGTH = 60;
export const STIPEND_PERIODS = ['month', 'year', 'hour'] as const;
export const INTERVIEW_TYPES = [
  'oa',
  'phone_screen',
  'technical',
  'hr',
  'managerial',
  'final',
] as const;
export const INTERVIEW_MODES = ['onsite', 'video', 'phone'] as const;
export const INTERVIEW_OUTCOMES = ['pending', 'passed', 'failed', 'cancelled'] as const;

export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];
export type WorkMode = (typeof WORK_MODES)[number];
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];
export type Priority = (typeof PRIORITIES)[number];
export type Source = (typeof SOURCES)[number];
export type StipendPeriod = (typeof STIPEND_PERIODS)[number];
export type InterviewType = (typeof INTERVIEW_TYPES)[number];
export type InterviewMode = (typeof INTERVIEW_MODES)[number];
export type InterviewOutcome = (typeof INTERVIEW_OUTCOMES)[number];

export const MAX_NOTES_LENGTH = 10_000;

/**
 * The calendar years an applied date, deadline or interview may fall in. Nothing
 * an internship search tracks predates 2000 or runs past 2099; the lower bound
 * also catches a two-digit year typed into a native date input, which the
 * browser reads as year 0026.
 */
export const MIN_DATE_YEAR = 2000;
export const MAX_DATE_YEAR = 2099;

/**
 * The shape version every new application document is written at. See
 * `CURRENT_USER_SCHEMA_VERSION` for how this is meant to be changed.
 */
export const CURRENT_APPLICATION_SCHEMA_VERSION = 1;

export interface Interview {
  _id: Types.ObjectId;
  type: InterviewType;
  scheduledAt: Date;
  durationMins?: number;
  mode: InterviewMode;
  link?: string;
  interviewer?: string;
  round?: number;
  outcome: InterviewOutcome;
  feedback?: string;
  prepNotes?: string;
}

export interface StatusHistoryEntry {
  from: ApplicationStatus | null;
  to: ApplicationStatus;
  changedAt: Date;
  note?: string;
}

export interface Attachment {
  _id: Types.ObjectId;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  url: string;
  uploadedAt: Date;
}

export interface Stipend {
  amount: number;
  currency: string;
  period: StipendPeriod;
}

export interface Contact {
  name?: string;
  email?: string;
  role?: string;
  linkedin?: string;
}

export interface ApplicationAttributes {
  user: Types.ObjectId;
  company: string;
  companyWebsite?: string;
  companyLogoUrl?: string;
  role: string;
  location?: string;
  workMode?: WorkMode;
  employmentType: EmploymentType;
  stipend?: Stipend;
  status: ApplicationStatus;
  priority: Priority;
  source?: Source | LegacySource;
  /** What "Other" actually was. Only kept while `source` is `other`. */
  sourceOther?: string;
  jobUrl?: string;
  appliedDate?: Date;
  deadline?: Date;
  nextActionDate?: Date;
  contact?: Contact;
  resumeVersion?: string;
  tags: string[];
  notes?: string;
  interviews: Types.DocumentArray<Interview>;
  statusHistory: StatusHistoryEntry[];
  archived: boolean;
  attachments: Types.DocumentArray<Attachment>;
  schemaVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

export type ApplicationModelType = Model<ApplicationAttributes>;
export type ApplicationDocument = HydratedDocument<ApplicationAttributes>;

/** Subdocument ids are surfaced as `id`, matching the parent document shape. */
const subdocumentJson = {
  transform: (_document: unknown, record: Record<string, unknown>) => {
    record.id = record._id;
    delete record._id;
    return record;
  },
};

const interviewSchema = new Schema<Interview>(
  {
    type: { type: String, enum: INTERVIEW_TYPES, required: true },
    scheduledAt: { type: Date, required: true },
    durationMins: { type: Number, min: 1, max: 1440 },
    mode: { type: String, enum: INTERVIEW_MODES, required: true },
    link: { type: String, maxlength: 2048 },
    interviewer: { type: String, maxlength: 120 },
    round: { type: Number, min: 1, max: 20 },
    outcome: { type: String, enum: INTERVIEW_OUTCOMES, default: 'pending' },
    feedback: { type: String, maxlength: 5_000 },
    prepNotes: { type: String, maxlength: 5_000 },
  },
  { toJSON: subdocumentJson },
);

const attachmentSchema = new Schema<Attachment>(
  {
    filename: { type: String, required: true },
    originalName: { type: String, required: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true, min: 0 },
    url: { type: String, required: true },
    uploadedAt: { type: Date, default: Date.now },
  },
  {
    toJSON: {
      transform: (_document: unknown, record: Record<string, unknown>) => {
        record.id = record._id;
        delete record._id;
        // The storage key never leaves the server: downloads go through a signed
        // URL minted on demand, so the client has no use for it.
        delete record.filename;
        return record;
      },
    },
  },
);

// Value objects rather than entities: an id on each row would be noise in the
// timeline the detail page renders from this array.
const statusHistorySchema = new Schema<StatusHistoryEntry>(
  {
    from: { type: String, enum: [...APPLICATION_STATUSES, null], default: null },
    to: { type: String, enum: APPLICATION_STATUSES, required: true },
    changedAt: { type: Date, required: true },
    note: { type: String, maxlength: 1_000 },
  },
  { _id: false },
);

const stipendSchema = new Schema<Stipend>(
  {
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, required: true, minlength: 3, maxlength: 3, uppercase: true },
    period: { type: String, enum: STIPEND_PERIODS, required: true },
  },
  { _id: false },
);

const contactSchema = new Schema<Contact>(
  {
    name: { type: String, maxlength: 120 },
    email: { type: String, lowercase: true, trim: true, maxlength: 254 },
    role: { type: String, maxlength: 120 },
    linkedin: { type: String, maxlength: 2048 },
  },
  { _id: false },
);

const applicationSchema = new Schema<ApplicationAttributes, ApplicationModelType>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    company: { type: String, required: true, trim: true, maxlength: 160 },
    companyWebsite: { type: String, trim: true, maxlength: 2048 },
    companyLogoUrl: { type: String, maxlength: 2048 },
    role: { type: String, required: true, trim: true, maxlength: 160 },
    location: { type: String, trim: true, maxlength: 160 },
    workMode: { type: String, enum: WORK_MODES },
    employmentType: { type: String, enum: EMPLOYMENT_TYPES, default: 'internship' },
    stipend: { type: stipendSchema },
    status: { type: String, enum: APPLICATION_STATUSES, default: 'saved', required: true },
    priority: { type: String, enum: PRIORITIES, default: 'medium' },
    source: { type: String, enum: [...SOURCES, ...Object.keys(LEGACY_SOURCE_LABELS)] },
    sourceOther: { type: String, trim: true, maxlength: MAX_SOURCE_OTHER_LENGTH },
    jobUrl: { type: String, maxlength: 2048 },
    appliedDate: { type: Date },
    deadline: { type: Date },
    nextActionDate: { type: Date },
    contact: { type: contactSchema },
    resumeVersion: { type: String, maxlength: 120 },
    tags: { type: [String], default: [], index: true },
    notes: { type: String, maxlength: MAX_NOTES_LENGTH },
    interviews: { type: [interviewSchema], default: [] },
    statusHistory: { type: [statusHistorySchema], default: [] },
    archived: { type: Boolean, default: false },
    attachments: { type: [attachmentSchema], default: [] },
    schemaVersion: { type: Number, default: CURRENT_APPLICATION_SCHEMA_VERSION },
  },
  {
    timestamps: true,
    // Turns __v into a real optimistic lock: every save() filters on the __v that
    // was loaded and throws VersionError when another writer got there first.
    optimisticConcurrency: true,
    toJSON: {
      transform: (_document, record: Record<string, unknown>) => {
        record.id = record._id;
        record.version = record.__v;
        delete record._id;
        delete record.__v;
        return record;
      },
    },
  },
);

applicationSchema.index({ user: 1, status: 1 });
applicationSchema.index({ user: 1, deadline: 1 });
applicationSchema.index({ user: 1, createdAt: -1 });
applicationSchema.index({ company: 'text', role: 'text', notes: 'text', tags: 'text' });

export const Application = model<ApplicationAttributes, ApplicationModelType>(
  'Application',
  applicationSchema,
);
