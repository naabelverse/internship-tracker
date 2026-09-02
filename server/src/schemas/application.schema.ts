import { Types } from 'mongoose';
import { z } from 'zod';
import {
  APPLICATION_STATUSES,
  EMPLOYMENT_TYPES,
  INTERVIEW_MODES,
  INTERVIEW_OUTCOMES,
  INTERVIEW_TYPES,
  MAX_NOTES_LENGTH,
  PRIORITIES,
  SOURCES,
  STIPEND_PERIODS,
  WORK_MODES,
} from '@/models/Application';

export const SORTABLE_FIELDS = [
  'createdAt',
  'updatedAt',
  'company',
  'role',
  'status',
  'priority',
  'deadline',
  'appliedDate',
  'nextActionDate',
] as const;

export type SortableField = (typeof SORTABLE_FIELDS)[number];

export const MAX_BULK_IDS = 100;
export const MAX_IMPORT_ROWS = 1_000;

const objectId = z.string().refine((value) => Types.ObjectId.isValid(value), 'must be a valid id');

const optionalUrl = z.string().trim().url('must be a valid URL').max(2048).optional();

const stipendSchema = z.object({
  amount: z.number().nonnegative(),
  currency: z.string().trim().length(3, 'must be a 3 letter currency code'),
  period: z.enum(STIPEND_PERIODS),
});

const contactSchema = z.object({
  name: z.string().trim().max(120).optional(),
  email: z.string().trim().toLowerCase().email().max(254).optional(),
  role: z.string().trim().max(120).optional(),
  linkedin: z.string().trim().url().max(2048).optional(),
});

/**
 * Writable application fields. `companyLogoUrl` and `nextActionDate` are absent
 * on purpose: both are derived server-side, and a strict schema rejects any
 * attempt to set them rather than silently dropping the value.
 */
const applicationFields = {
  company: z.string().trim().min(1, 'is required').max(160),
  role: z.string().trim().min(1, 'is required').max(160),
  companyWebsite: optionalUrl,
  location: z.string().trim().max(160).optional(),
  workMode: z.enum(WORK_MODES).optional(),
  employmentType: z.enum(EMPLOYMENT_TYPES).optional(),
  stipend: stipendSchema.optional(),
  status: z.enum(APPLICATION_STATUSES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  source: z.enum(SOURCES).optional(),
  jobUrl: optionalUrl,
  appliedDate: z.coerce.date().optional(),
  deadline: z.coerce.date().optional(),
  contact: contactSchema.optional(),
  resumeVersion: z.string().trim().max(120).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(30).optional(),
  notes: z.string().max(MAX_NOTES_LENGTH).optional(),
  archived: z.boolean().optional(),
};

export const createApplicationSchema = z.object(applicationFields).strict();

export const updateApplicationSchema = z
  .object({
    ...applicationFields,
    company: applicationFields.company.optional(),
    role: applicationFields.role.optional(),
    version: z.number().int().nonnegative().optional(),
  })
  .strict()
  .refine(
    (value) => Object.keys(value).some((key) => key !== 'version'),
    'at least one field must be provided',
  );

export const statusChangeSchema = z
  .object({
    status: z.enum(APPLICATION_STATUSES),
    note: z.string().trim().max(1_000).optional(),
  })
  .strict();

export const bulkActionSchema = z
  .object({
    ids: z.array(objectId).min(1, 'at least one id is required').max(MAX_BULK_IDS),
    action: z.enum(['delete', 'archive', 'unarchive', 'setStatus']),
    payload: z
      .object({ status: z.enum(APPLICATION_STATUSES).optional() })
      .strict()
      .optional(),
  })
  .strict()
  .refine(
    (value) => value.action !== 'setStatus' || value.payload?.status !== undefined,
    'payload.status is required when action is setStatus',
  );

export const interviewFields = {
  type: z.enum(INTERVIEW_TYPES),
  scheduledAt: z.coerce.date(),
  durationMins: z.number().int().min(1).max(1440).optional(),
  mode: z.enum(INTERVIEW_MODES),
  link: optionalUrl,
  interviewer: z.string().trim().max(120).optional(),
  round: z.number().int().min(1).max(20).optional(),
  outcome: z.enum(INTERVIEW_OUTCOMES).optional(),
  feedback: z.string().max(5_000).optional(),
  prepNotes: z.string().max(5_000).optional(),
};

export const createInterviewSchema = z.object(interviewFields).strict();

export const updateInterviewSchema = z
  .object({
    ...interviewFields,
    type: interviewFields.type.optional(),
    scheduledAt: interviewFields.scheduledAt.optional(),
    mode: interviewFields.mode.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'at least one field must be provided');

export const applicationIdParams = z.object({ id: objectId }).strict();
export const interviewIdParams = z.object({ id: objectId, interviewId: objectId }).strict();
export const attachmentIdParams = z.object({ id: objectId, attachmentId: objectId }).strict();

/** Accepts both repeated keys and comma separated values for array filters. */
function toStringArray(value: unknown): unknown {
  if (value === undefined) return undefined;

  return (Array.isArray(value) ? value : [value])
    .flatMap((entry) => (typeof entry === 'string' ? entry.split(',') : [entry]))
    .map((entry) => (typeof entry === 'string' ? entry.trim() : entry))
    .filter((entry) => entry !== '');
}

function enumArray<T extends readonly [string, ...string[]]>(values: T) {
  return z.preprocess(toStringArray, z.array(z.enum(values)).optional());
}

const optionalBoolean = z.preprocess(
  (value) => (value === undefined ? undefined : value === true || value === 'true'),
  z.boolean().optional(),
);

const sortSchema = z
  .string()
  .default('createdAt:desc')
  .transform((value, ctx) => {
    const [field, direction] = value.split(':');
    const isSortable = (SORTABLE_FIELDS as readonly string[]).includes(field);

    if (!isSortable || (direction !== 'asc' && direction !== 'desc')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `must be field:asc or field:desc, where field is one of ${SORTABLE_FIELDS.join(', ')}`,
      });
      return z.NEVER;
    }

    return { field: field as SortableField, direction };
  });

export const listApplicationsQuerySchema = z
  .object({
    search: z.string().trim().min(1).max(160).optional(),
    status: enumArray(APPLICATION_STATUSES),
    source: enumArray(SOURCES),
    workMode: enumArray(WORK_MODES),
    priority: enumArray(PRIORITIES),
    tags: z.preprocess(toStringArray, z.array(z.string().trim().min(1).max(40)).optional()),
    company: z.string().trim().min(1).max(160).optional(),
    dateFrom: z.coerce.date().optional(),
    dateTo: z.coerce.date().optional(),
    archived: optionalBoolean,
    sort: sortSchema,
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

export const exportQuerySchema = z
  .object({ format: z.enum(['csv', 'json']).default('csv') })
  .strict();

export type CreateApplicationInput = z.infer<typeof createApplicationSchema>;
export type UpdateApplicationInput = z.infer<typeof updateApplicationSchema>;
export type StatusChangeInput = z.infer<typeof statusChangeSchema>;
export type BulkActionInput = z.infer<typeof bulkActionSchema>;
export type CreateInterviewInput = z.infer<typeof createInterviewSchema>;
export type UpdateInterviewInput = z.infer<typeof updateInterviewSchema>;
export type ListApplicationsQuery = z.infer<typeof listApplicationsQuerySchema>;
export type ExportQuery = z.infer<typeof exportQuerySchema>;
