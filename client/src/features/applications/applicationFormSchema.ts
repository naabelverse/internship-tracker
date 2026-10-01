import { z } from 'zod';
import type { ApplicationPayload } from '@/api/applications';
import { DATE_RANGE_MESSAGE, isDateInputInRange } from '@/lib/dateInput';
import { isKnownSource, sourceLabel } from '@/lib/statusConfig';
import {
  APPLICATION_STATUSES,
  EMPLOYMENT_TYPES,
  MAX_NOTES_LENGTH,
  MAX_SOURCE_OTHER_LENGTH,
  PRIORITIES,
  SOURCES,
  WORK_MODES,
  type Application,
} from '@/types/application';

/** An empty select or text input arrives as '', which the API must not receive. */
const optionalText = z
  .string()
  .trim()
  .max(160)
  .optional()
  .transform((value) => (value === '' ? undefined : value));

const optionalUrl = z
  .string()
  .trim()
  .max(2048)
  .optional()
  .refine(
    (value) => !value || z.string().url().safeParse(value).success,
    'Enter a full URL, including https://',
  )
  .transform((value) => (value === '' ? undefined : value));

const optionalDate = z
  .string()
  .optional()
  .refine((value) => value === undefined || isDateInputInRange(value), DATE_RANGE_MESSAGE)
  .transform((value) => (value === '' ? undefined : value));

/**
 * Mirrors the writable half of `server/src/schemas/application.schema.ts`.
 * `companyLogoUrl` and `nextActionDate` are absent here for the same reason they
 * are absent there: both are derived server-side, and the server rejects them.
 *
 * `sourceOther` is the one place the form is stricter than the API: "Other" on
 * its own is the answer nobody can decode a month later, so the form asks what
 * it was. The API leaves it optional for imports and older clients.
 */
export const applicationFormSchema = z
  .object({
    company: z.string().trim().min(1, 'Enter the company').max(160),
    role: z.string().trim().min(1, 'Enter the role').max(160),
    status: z.enum(APPLICATION_STATUSES),
    priority: z.enum(PRIORITIES),
    employmentType: z.enum(EMPLOYMENT_TYPES),
    workMode: z.union([z.enum(WORK_MODES), z.literal('')]),
    source: z.union([z.enum(SOURCES), z.literal('')]),
    sourceOther: z
      .string()
      .trim()
      .max(MAX_SOURCE_OTHER_LENGTH, `Keep it under ${String(MAX_SOURCE_OTHER_LENGTH)} characters`)
      .optional(),
    location: optionalText,
    companyWebsite: optionalUrl,
    jobUrl: optionalUrl,
    appliedDate: optionalDate,
    deadline: optionalDate,
    resumeVersion: optionalText,
    tagsText: z.string().max(400).optional(),
    notes: z.string().max(MAX_NOTES_LENGTH, 'Notes are capped at 10,000 characters').optional(),
  })
  .superRefine((values, context) => {
    if (values.source === 'other' && !values.sourceOther) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sourceOther'],
        message: 'Say where you found it',
      });
    }
  });

export type ApplicationFormValues = z.infer<typeof applicationFormSchema>;

/** `2026-01-31T00:00:00.000Z` to `2026-01-31`, which is what a date input wants. */
function toDateInput(value: string | undefined): string {
  return value ? value.slice(0, 10) : '';
}

/**
 * A stored source that has since left the list would match no option, so the
 * select would silently show "Not set" and the next save would keep the retired
 * value. Opening it as "Other", with the old value as the specify text, shows
 * the user what was recorded and saves it in the current shape.
 */
function toSourceFields(
  application?: Application,
): Pick<ApplicationFormValues, 'source' | 'sourceOther'> {
  const stored: string = application?.source ?? '';
  const sourceOther = application?.sourceOther ?? '';

  if (stored === '' || isKnownSource(stored)) return { source: stored, sourceOther };
  return { source: 'other', sourceOther: sourceOther || sourceLabel(stored) };
}

export function toFormValues(application?: Application): ApplicationFormValues {
  return {
    company: application?.company ?? '',
    role: application?.role ?? '',
    status: application?.status ?? 'saved',
    priority: application?.priority ?? 'medium',
    employmentType: application?.employmentType ?? 'internship',
    workMode: application?.workMode ?? '',
    ...toSourceFields(application),
    location: application?.location ?? '',
    companyWebsite: application?.companyWebsite ?? '',
    jobUrl: application?.jobUrl ?? '',
    appliedDate: toDateInput(application?.appliedDate),
    deadline: toDateInput(application?.deadline),
    resumeVersion: application?.resumeVersion ?? '',
    tagsText: (application?.tags ?? []).join(', '),
    notes: application?.notes ?? '',
  };
}

export function parseTags(tagsText: string | undefined): string[] {
  return (tagsText ?? '')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 30);
}

/** The specify text travels only with "Other"; the server drops it otherwise too. */
function sourceOtherOf(values: ApplicationFormValues): string | undefined {
  return values.source === 'other' ? values.sourceOther : undefined;
}

/** Turns validated form values into the request body the API accepts. */
export function toPayload(values: ApplicationFormValues): ApplicationPayload {
  return {
    company: values.company,
    role: values.role,
    status: values.status,
    priority: values.priority,
    employmentType: values.employmentType,
    workMode: values.workMode === '' ? undefined : values.workMode,
    source: values.source === '' ? undefined : values.source,
    sourceOther: sourceOtherOf(values),
    location: values.location,
    companyWebsite: values.companyWebsite,
    jobUrl: values.jobUrl,
    appliedDate: values.appliedDate ? `${values.appliedDate}T00:00:00.000Z` : undefined,
    deadline: values.deadline ? `${values.deadline}T00:00:00.000Z` : undefined,
    resumeVersion: values.resumeVersion,
    tags: parseTags(values.tagsText),
    notes: values.notes === '' ? undefined : values.notes,
  };
}

/** The subset shown optimistically before the server answers. */
export function toOptimisticPatch(values: ApplicationFormValues): Partial<Application> {
  return {
    company: values.company,
    role: values.role,
    status: values.status,
    priority: values.priority,
    employmentType: values.employmentType,
    workMode: values.workMode === '' ? undefined : values.workMode,
    source: values.source === '' ? undefined : values.source,
    sourceOther: sourceOtherOf(values),
    location: values.location,
    deadline: values.deadline ? `${values.deadline}T00:00:00.000Z` : undefined,
    tags: parseTags(values.tagsText),
  };
}
