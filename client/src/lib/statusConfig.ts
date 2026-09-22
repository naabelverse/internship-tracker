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

/**
 * The custom property a status paints with, everywhere it is painted.
 *
 * Applied, Interview, Offer and Rejected carry the semantic their token already
 * means - the hero copy says amber is the only colour that means hurry, and
 * that is Interview - so they share it rather than duplicating its value. The
 * other four have no semantic to borrow and have tokens of their own.
 */
export type StatusToken =
  | 'color-status-saved'
  | 'color-info'
  | 'color-status-assessment'
  | 'color-warning'
  | 'color-success'
  | 'color-danger'
  | 'color-status-ghosted'
  | 'color-status-withdrawn';

interface StatusConfig {
  label: string;
  token: StatusToken;
  /** Token-based classes only; SPEC section 6 forbids fixed pixel colours. */
  pill: string;
  dot: string;
  /**
   * Drawn as a ring rather than a filled disc. Colour is one signal; this is
   * the second, for a reader who cannot see the hue difference at dot size.
   */
  hollow?: true;
}

/**
 * One place that turns a status into words and colour. The board, the table, the
 * timeline, the detail header and the dashboard doughnut all read from here, so
 * a status can never be spelled or coloured two ways.
 *
 * The class strings are spelled out rather than built from `token`, because
 * Tailwind only emits a utility it can find as a literal in the source. That
 * they name the same token is asserted by `tests/config/statusConfig.test.ts`,
 * which is what lets the doughnut read `token` directly and still be certain
 * its slice matches the pill.
 */
export const STATUS_CONFIG: Record<ApplicationStatus, StatusConfig> = {
  saved: {
    label: 'Saved',
    token: 'color-status-saved',
    pill: 'bg-status-saved/15 text-status-saved',
    dot: 'bg-status-saved',
  },
  applied: { label: 'Applied', token: 'color-info', pill: 'bg-info/15 text-info', dot: 'bg-info' },
  assessment: {
    label: 'Assessment',
    token: 'color-status-assessment',
    pill: 'bg-status-assessment/15 text-status-assessment',
    dot: 'bg-status-assessment',
  },
  interview: {
    label: 'Interview',
    token: 'color-warning',
    pill: 'bg-warning/15 text-warning',
    dot: 'bg-warning',
  },
  offer: {
    label: 'Offer',
    token: 'color-success',
    pill: 'bg-success/15 text-success',
    dot: 'bg-success',
  },
  rejected: {
    label: 'Rejected',
    token: 'color-danger',
    pill: 'bg-danger/15 text-danger',
    dot: 'bg-danger',
  },
  ghosted: {
    label: 'Ghosted',
    token: 'color-status-ghosted',
    pill: 'bg-status-ghosted/15 text-status-ghosted',
    // A ring, not a disc: the other side went quiet. It is also the pair that
    // was broken - Saved and Ghosted were two greys - and a shape survives
    // whatever a reader's eyes do to the hue.
    dot: 'border-status-ghosted bg-transparent',
    hollow: true,
  },
  withdrawn: {
    label: 'Withdrawn',
    token: 'color-status-withdrawn',
    pill: 'bg-status-withdrawn/15 text-status-withdrawn',
    dot: 'bg-status-withdrawn',
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
