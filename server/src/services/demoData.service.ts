import type { InsertManyOptions, Types } from 'mongoose';
import {
  Application,
  type ApplicationStatus,
  type EmploymentType,
  type Priority,
  type Source,
  type StatusHistoryEntry,
  type WorkMode,
} from '@/models/Application';
import { ApiError } from '@/utils/ApiError';

const MS_PER_DAY = 86_400_000;
const MS_PER_HOUR = 3_600_000;

/**
 * SPEC section 9 asks for 60+ applications spread over six months, with every
 * chart populated. This is the shared generator behind both the dashboard's
 * "Load demo data" button and, from phase 10, `npm run seed` — so there is one
 * definition of "realistic data" rather than one per entry point.
 */
export const DEMO_APPLICATION_COUNT = 64;

const DEMO_WINDOW_DAYS = 182;

/**
 * Deterministic PRNG, so the same seed always produces the same dashboard.
 * `Math.random` would make a failing assertion about the generated spread
 * impossible to reproduce.
 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

interface Picker {
  next: () => number;
  /** A uniform integer in `[min, max]`. */
  int: (min: number, max: number) => number;
  from: <T>(values: readonly T[]) => T;
  chance: (probability: number) => boolean;
}

function createPicker(seed: number): Picker {
  const next = mulberry32(seed);

  const int = (min: number, max: number): number => min + Math.floor(next() * (max - min + 1));

  return {
    next,
    int,
    from: (values) => values[int(0, values.length - 1)],
    chance: (probability) => next() < probability,
  };
}

const COMPANIES = [
  { name: 'Grab', website: 'https://grab.com' },
  { name: 'Shopee', website: 'https://shopee.com' },
  { name: 'Stripe', website: 'https://stripe.com' },
  { name: 'Canva', website: 'https://canva.com' },
  { name: 'Atlassian', website: 'https://atlassian.com' },
  { name: 'Datadog', website: 'https://datadoghq.com' },
  { name: 'Figma', website: 'https://figma.com' },
  { name: 'Airwallex', website: 'https://airwallex.com' },
  { name: 'Sea Group', website: 'https://sea.com' },
  { name: 'Razer', website: 'https://razer.com' },
  { name: 'Petronas Digital', website: 'https://petronas.com' },
  { name: 'AirAsia MOVE', website: 'https://airasia.com' },
  { name: 'Setel', website: 'https://setel.com' },
  { name: 'MoneyLion', website: 'https://moneylion.com' },
  { name: 'Aerodyne', website: 'https://aerodyne.group' },
] as const;

const ROLES = [
  'Software Engineer Intern',
  'Backend Engineer Intern',
  'Frontend Engineer Intern',
  'Data Engineer Intern',
  'Machine Learning Intern',
  'Platform Engineer Intern',
  'Mobile Engineer Intern',
  'Site Reliability Intern',
  'Product Analyst Intern',
  'Security Engineer Intern',
] as const;

const LOCATIONS = [
  'Kuala Lumpur, MY',
  'Singapore, SG',
  'Penang, MY',
  'Remote — APAC',
  'Cyberjaya, MY',
  'Sydney, AU',
] as const;

const TAG_POOL = [
  'typescript',
  'react',
  'node',
  'python',
  'golang',
  'kubernetes',
  'fintech',
  'dream-company',
  'referred',
  'fast-process',
] as const;

const DEMO_SOURCES: readonly Source[] = [
  'jobstreet',
  'jobstreet',
  'linkedin',
  'linkedin',
  'hiredly',
  'maukerja',
  'myfuturejobs',
  'indeed',
  'company_site',
  'company_site',
  'referral',
  'career_fair',
  'other',
];

/** What an "Other" demo row says it was, so the specify text is visible in the demo. */
const DEMO_SOURCE_OTHERS = ['Glints', 'University career portal', 'Instagram post'] as const;

const DEMO_WORK_MODES: readonly WorkMode[] = ['remote', 'hybrid', 'onsite'];
const DEMO_PRIORITIES: readonly Priority[] = ['low', 'medium', 'medium', 'high'];
const DEMO_EMPLOYMENT_TYPES: readonly EmploymentType[] = ['internship', 'internship', 'part-time'];

const INTERVIEWERS = ['A. Rahman', 'Priya N.', 'Wei Ling', 'Daniel O.', 'Sara K.'] as const;
const NOTE_TEAMS = ['platform', 'payments', 'growth'] as const;

/**
 * A believable outcome distribution: most applications sit in the middle of the
 * funnel or get rejected, a few convert, and a handful never leave the list.
 * Repetition is the weighting — one entry per share of the likelihood.
 */
const OUTCOMES: readonly ApplicationStatus[] = [
  'saved',
  'saved',
  'saved',
  'saved',
  'applied',
  'applied',
  'applied',
  'applied',
  'applied',
  'applied',
  'applied',
  'assessment',
  'assessment',
  'assessment',
  'interview',
  'interview',
  'interview',
  'offer',
  'offer',
  'rejected',
  'rejected',
  'rejected',
  'rejected',
  'rejected',
  'ghosted',
  'ghosted',
  'withdrawn',
];

/** The path a record walks to reach its outcome, so `statusHistory` is real. */
const PATH_TO: Record<ApplicationStatus, readonly ApplicationStatus[]> = {
  saved: ['saved'],
  applied: ['saved', 'applied'],
  assessment: ['saved', 'applied', 'assessment'],
  interview: ['saved', 'applied', 'assessment', 'interview'],
  offer: ['saved', 'applied', 'assessment', 'interview', 'offer'],
  rejected: ['saved', 'applied', 'rejected'],
  ghosted: ['saved', 'applied', 'ghosted'],
  withdrawn: ['saved', 'applied', 'withdrawn'],
};

const INTERVIEW_ROUNDS = [
  { type: 'oa' as const, mode: 'video' as const, durationMins: 90 },
  { type: 'phone_screen' as const, mode: 'phone' as const, durationMins: 30 },
  { type: 'technical' as const, mode: 'video' as const, durationMins: 60 },
  { type: 'hr' as const, mode: 'video' as const, durationMins: 45 },
  { type: 'final' as const, mode: 'onsite' as const, durationMins: 120 },
];

function pickTags(picker: Picker): string[] {
  const count = picker.int(0, 3);
  const tags = new Set<string>();

  while (tags.size < count) tags.add(picker.from(TAG_POOL));

  return [...tags];
}

/**
 * Walks the status path forward from `createdAt`, spending a few days in each
 * stage, so the timeline, the funnel and the "days to first response" average
 * all see plausible gaps rather than one timestamp repeated.
 */
function buildHistory(
  path: readonly ApplicationStatus[],
  createdAt: Date,
  now: Date,
  picker: Picker,
): StatusHistoryEntry[] {
  const history: StatusHistoryEntry[] = [];
  let cursor = createdAt.getTime();
  let previous: ApplicationStatus | null = null;

  for (const status of path) {
    if (cursor > now.getTime()) break;

    history.push({ from: previous, to: status, changedAt: new Date(cursor) });
    previous = status;
    cursor += picker.int(1, 12) * MS_PER_DAY + picker.int(0, 23) * MS_PER_HOUR;
  }

  return history;
}

function interviewCountFor(status: ApplicationStatus, picker: Picker): number {
  if (status === 'interview' || status === 'offer') return picker.int(2, 3);

  return status === 'assessment' ? 1 : 0;
}

/** Attributes for one demo application, shaped for `insertMany`. */
type DemoApplication = Record<string, unknown>;

function buildOne(
  userId: Types.ObjectId,
  index: number,
  now: Date,
  picker: Picker,
): DemoApplication {
  const company = picker.from(COMPANIES);
  const source = picker.from(DEMO_SOURCES);
  // Weighted towards the recent half of the window, which is how a real search
  // ramps up, and what makes the timeline chart show a trend rather than noise.
  const daysAgo = Math.round(DEMO_WINDOW_DAYS * picker.next() ** 1.4);
  const createdAt = new Date(
    now.getTime() - daysAgo * MS_PER_DAY - picker.int(0, 23) * MS_PER_HOUR,
  );

  const history = buildHistory(PATH_TO[picker.from(OUTCOMES)], createdAt, now, picker);
  const status = history[history.length - 1]?.to ?? 'saved';
  const appliedEntry = history.find((entry) => entry.to === 'applied');

  const interviews = Array.from({ length: interviewCountFor(status, picker) }, (_, round) => {
    const template = INTERVIEW_ROUNDS[round % INTERVIEW_ROUNDS.length];
    // A round already behind us has a verdict; one still ahead stays pending.
    const scheduledAt = new Date(
      createdAt.getTime() + (14 + round * 9) * MS_PER_DAY + picker.int(9, 17) * MS_PER_HOUR,
    );
    const isPast = scheduledAt.getTime() < now.getTime();
    const verdict = status === 'rejected' ? 'failed' : 'passed';

    return {
      ...template,
      scheduledAt,
      round: round + 1,
      outcome: isPast ? verdict : 'pending',
      interviewer: picker.from(INTERVIEWERS),
    };
  });

  // A spread of past and upcoming deadlines, so the amber and red chips and the
  // upcoming panel both have something to show.
  // Date-only, as the form stores one: the day at 00:00 UTC. A seed-moment time
  // such as 22:45 would show on every demo deadline (issue #99).
  const deadline = picker.chance(0.55)
    ? new Date(
        Math.floor((createdAt.getTime() + picker.int(10, 60) * MS_PER_DAY) / MS_PER_DAY) *
          MS_PER_DAY,
      )
    : undefined;

  return {
    user: userId,
    company: company.name,
    companyWebsite: company.website,
    role: picker.from(ROLES),
    location: picker.from(LOCATIONS),
    workMode: picker.from(DEMO_WORK_MODES),
    employmentType: picker.from(DEMO_EMPLOYMENT_TYPES),
    status,
    priority: picker.from(DEMO_PRIORITIES),
    source,
    sourceOther: source === 'other' ? picker.from(DEMO_SOURCE_OTHERS) : undefined,
    jobUrl: `${company.website}/careers/${String(1000 + index)}`,
    appliedDate: appliedEntry?.changedAt,
    deadline,
    tags: pickTags(picker),
    notes: picker.chance(0.4)
      ? `Referred by a senior on the ${picker.from(NOTE_TEAMS)} team. Follow up if nothing lands in a week.`
      : undefined,
    interviews,
    statusHistory: history,
    archived: status === 'withdrawn' && picker.chance(0.5),
    stipend: picker.chance(0.6)
      ? { amount: picker.int(15, 40) * 100, currency: 'MYR', period: 'month' }
      : undefined,
    createdAt,
    updatedAt: history[history.length - 1]?.changedAt ?? createdAt,
  };
}

/**
 * Builds the demo set without touching the database, so the generator can be
 * unit tested and reused by the seed script.
 */
export function buildDemoApplications(
  userId: Types.ObjectId,
  now: Date = new Date(),
  seed = 20_260_904,
): DemoApplication[] {
  const picker = createPicker(seed);

  return Array.from({ length: DEMO_APPLICATION_COUNT }, (_, index) =>
    buildOne(userId, index, now, picker),
  );
}

/**
 * Fills an empty account with the demo set.
 *
 * The emptiness check is the safety rail: this endpoint is reachable by any
 * signed-in user, and refusing on a non-empty account means it can never mix
 * fixture rows into someone's real search. `timestamps: false` keeps the
 * back-dated `createdAt` values Mongoose would otherwise overwrite with now.
 */
export async function loadDemoData(
  userId: Types.ObjectId,
  now: Date = new Date(),
): Promise<number> {
  const existing = await Application.countDocuments({ user: userId }).limit(1);

  if (existing > 0) {
    throw new ApiError(
      409,
      'Demo data can only be loaded into an account that has no applications yet.',
      'DEMO_DATA_NOT_EMPTY',
    );
  }

  const documents = buildDemoApplications(userId, now);

  // Mongoose honours `timestamps: false` at runtime, but its `InsertManyOptions`
  // type does not list it. Without the option the back-dated `createdAt` values
  // are overwritten with the insert time and every chart collapses onto today.
  await Application.insertMany(documents, { timestamps: false } as InsertManyOptions);

  return documents.length;
}
