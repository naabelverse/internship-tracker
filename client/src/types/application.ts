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
  'linkedin',
  'internshala',
  'indeed',
  'company_site',
  'referral',
  'career_fair',
  'other',
] as const;
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

/** SPEC section 4: notes are markdown, capped server-side at 10k characters. */
export const MAX_NOTES_LENGTH = 10_000;

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

export interface Interview {
  id: string;
  type: InterviewType;
  scheduledAt: string;
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
  changedAt: string;
  note?: string;
}

export interface Attachment {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
  url: string;
  uploadedAt: string;
}

export interface Application {
  id: string;
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
  source?: Source;
  jobUrl?: string;
  appliedDate?: string;
  deadline?: string;
  nextActionDate?: string;
  contact?: Contact;
  resumeVersion?: string;
  tags: string[];
  notes?: string;
  interviews: Interview[];
  statusHistory: StatusHistoryEntry[];
  archived: boolean;
  attachments: Attachment[];
  /** Mongoose `__v`, surfaced as the optimistic-concurrency token. */
  version: number;
  createdAt: string;
  updatedAt: string;
}

export type BulkAction = 'delete' | 'archive' | 'unarchive' | 'setStatus';

export interface BulkResult {
  matched: number;
  modified: number;
  notFound: string[];
}

/** SPEC section 7: the 409 payload the UI turns into a reload/overwrite prompt. */
export type ConflictSource = 'stale_read' | 'concurrent_write';

export interface VersionConflict {
  current: Application | null;
  conflictSource: ConflictSource;
}
