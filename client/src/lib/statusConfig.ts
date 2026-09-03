import type {
  ApplicationStatus,
  EmploymentType,
  InterviewMode,
  InterviewOutcome,
  InterviewType,
  Priority,
  Source,
  WorkMode,
} from '@/types/application';

interface StatusConfig {
  label: string;
  /** Token-based classes only; SPEC section 6 forbids fixed pixel colours. */
  pill: string;
  dot: string;
}

/**
 * One place that turns a status into words and colour. The board, the table, the
 * timeline and the detail header all read from here, so a status can never be
 * spelled or coloured two ways.
 */
export const STATUS_CONFIG: Record<ApplicationStatus, StatusConfig> = {
  saved: { label: 'Saved', pill: 'bg-surface-muted text-content-muted', dot: 'bg-content-subtle' },
  applied: { label: 'Applied', pill: 'bg-info/15 text-info', dot: 'bg-info' },
  assessment: {
    label: 'Assessment',
    pill: 'bg-primary/15 text-primary',
    dot: 'bg-primary',
  },
  interview: { label: 'Interview', pill: 'bg-warning/15 text-warning', dot: 'bg-warning' },
  offer: { label: 'Offer', pill: 'bg-success/15 text-success', dot: 'bg-success' },
  rejected: { label: 'Rejected', pill: 'bg-danger/15 text-danger', dot: 'bg-danger' },
  ghosted: {
    label: 'Ghosted',
    pill: 'bg-surface-muted text-content-subtle',
    dot: 'bg-border-strong',
  },
  withdrawn: {
    label: 'Withdrawn',
    pill: 'bg-surface-muted text-content-subtle',
    dot: 'bg-border-strong',
  },
};

export const PRIORITY_CONFIG: Record<Priority, { label: string; dot: string }> = {
  low: { label: 'Low', dot: 'bg-content-subtle' },
  medium: { label: 'Medium', dot: 'bg-info' },
  high: { label: 'High', dot: 'bg-danger' },
};

export const SOURCE_LABELS: Record<Source, string> = {
  linkedin: 'LinkedIn',
  internshala: 'Internshala',
  indeed: 'Indeed',
  company_site: 'Company site',
  referral: 'Referral',
  career_fair: 'Career fair',
  other: 'Other',
};

export const WORK_MODE_LABELS: Record<WorkMode, string> = {
  remote: 'Remote',
  hybrid: 'Hybrid',
  onsite: 'On site',
};

export const EMPLOYMENT_TYPE_LABELS: Record<EmploymentType, string> = {
  internship: 'Internship',
  'part-time': 'Part time',
  'full-time': 'Full time',
};

export const INTERVIEW_TYPE_LABELS: Record<InterviewType, string> = {
  oa: 'Online assessment',
  phone_screen: 'Phone screen',
  technical: 'Technical',
  hr: 'HR',
  managerial: 'Managerial',
  final: 'Final round',
};

export const INTERVIEW_MODE_LABELS: Record<InterviewMode, string> = {
  onsite: 'On site',
  video: 'Video',
  phone: 'Phone',
};

export const INTERVIEW_OUTCOME_LABELS: Record<InterviewOutcome, string> = {
  pending: 'Pending',
  passed: 'Passed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};
