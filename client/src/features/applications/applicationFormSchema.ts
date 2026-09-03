import { z } from 'zod';
import type { ApplicationPayload } from '@/api/applications';
import {
  APPLICATION_STATUSES,
  EMPLOYMENT_TYPES,
  MAX_NOTES_LENGTH,
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
  .transform((value) => (value === '' ? undefined : value));

/**
 * Mirrors the writable half of `server/src/schemas/application.schema.ts`.
 * `companyLogoUrl` and `nextActionDate` are absent here for the same reason they
 * are absent there: both are derived server-side, and the server rejects them.
 */
export const applicationFormSchema = z.object({
  company: z.string().trim().min(1, 'Enter the company').max(160),
  role: z.string().trim().min(1, 'Enter the role').max(160),
  status: z.enum(APPLICATION_STATUSES),
  priority: z.enum(PRIORITIES),
  employmentType: z.enum(EMPLOYMENT_TYPES),
  workMode: z.union([z.enum(WORK_MODES), z.literal('')]),
  source: z.union([z.enum(SOURCES), z.literal('')]),
  location: optionalText,
  companyWebsite: optionalUrl,
  jobUrl: optionalUrl,
  appliedDate: optionalDate,
  deadline: optionalDate,
  resumeVersion: optionalText,
  tagsText: z.string().max(400).optional(),
  notes: z.string().max(MAX_NOTES_LENGTH, 'Notes are capped at 10,000 characters').optional(),
});

export type ApplicationFormValues = z.infer<typeof applicationFormSchema>;

/** `2026-01-31T00:00:00.000Z` to `2026-01-31`, which is what a date input wants. */
function toDateInput(value: string | undefined): string {
  return value ? value.slice(0, 10) : '';
}

export function toFormValues(application?: Application): ApplicationFormValues {
  return {
    company: application?.company ?? '',
    role: application?.role ?? '',
    status: application?.status ?? 'saved',
    priority: application?.priority ?? 'medium',
    employmentType: application?.employmentType ?? 'internship',
    workMode: application?.workMode ?? '',
    source: application?.source ?? '',
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
    location: values.location,
    deadline: values.deadline ? `${values.deadline}T00:00:00.000Z` : undefined,
    tags: parseTags(values.tagsText),
  };
}
