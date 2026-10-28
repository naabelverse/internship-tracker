import { APPLICATION_STATUSES, PRIORITIES, SOURCES, WORK_MODES } from '@/types/application';

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
export type SortDirection = 'asc' | 'desc';

export const DEFAULT_SORT = 'createdAt:desc';
export const DEFAULT_LIMIT = 20;

/** Splits the comma-separated encoding this module writes back out into a list. */
function readList<T extends string>(raw: string | null, allowed: readonly T[]): T[] {
  if (!raw) return [];

  const permitted = new Set<string>(allowed);
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry): entry is T => entry !== '' && permitted.has(entry));
}

function readFreeList(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/** A plain regex, not zod: `api/queryKeys` imports this file, so zod here lands in every route. */
const isoDate = /^\d{4}-\d{2}-\d{2}$/;

function readDate(raw: string | null): string | undefined {
  return raw !== null && isoDate.test(raw) ? raw : undefined;
}

function readInt(raw: string | null, fallback: number, min: number, max: number): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) return fallback;
  return value;
}

export interface ApplicationFilters {
  search: string;
  status: (typeof APPLICATION_STATUSES)[number][];
  source: (typeof SOURCES)[number][];
  workMode: (typeof WORK_MODES)[number][];
  priority: (typeof PRIORITIES)[number][];
  tags: string[];
  company: string;
  dateFrom?: string;
  dateTo?: string;
  archived: boolean;
  sort: string;
  page: number;
  limit: number;
}

export const EMPTY_FILTERS: ApplicationFilters = {
  search: '',
  status: [],
  source: [],
  workMode: [],
  priority: [],
  tags: [],
  company: '',
  archived: false,
  sort: DEFAULT_SORT,
  page: 1,
  limit: DEFAULT_LIMIT,
};

/**
 * Reads the whole filter state out of the URL.
 *
 * Anything unrecognised is dropped rather than rejected: a hand-edited or stale
 * link should still open the page on a sane view instead of an error screen.
 */
export function parseFilters(params: URLSearchParams): ApplicationFilters {
  const sortRaw = params.get('sort') ?? DEFAULT_SORT;
  const [field, direction] = sortRaw.split(':');
  const sortIsValid =
    (SORTABLE_FIELDS as readonly string[]).includes(field) &&
    (direction === 'asc' || direction === 'desc');

  return {
    search: params.get('search')?.trim() ?? '',
    status: readList(params.get('status'), APPLICATION_STATUSES),
    source: readList(params.get('source'), SOURCES),
    workMode: readList(params.get('workMode'), WORK_MODES),
    priority: readList(params.get('priority'), PRIORITIES),
    tags: readFreeList(params.get('tags')),
    company: params.get('company')?.trim() ?? '',
    dateFrom: readDate(params.get('dateFrom')),
    dateTo: readDate(params.get('dateTo')),
    archived: params.get('archived') === 'true',
    sort: sortIsValid ? sortRaw : DEFAULT_SORT,
    page: readInt(params.get('page'), 1, 1, 10_000),
    limit: readInt(params.get('limit'), DEFAULT_LIMIT, 1, 100),
  };
}

/**
 * Writes filters back to the URL, omitting everything still at its default so a
 * clean view keeps a clean, shareable address.
 */
export function toSearchParams(filters: ApplicationFilters): URLSearchParams {
  const params = new URLSearchParams();

  if (filters.search) params.set('search', filters.search);
  if (filters.status.length) params.set('status', filters.status.join(','));
  if (filters.source.length) params.set('source', filters.source.join(','));
  if (filters.workMode.length) params.set('workMode', filters.workMode.join(','));
  if (filters.priority.length) params.set('priority', filters.priority.join(','));
  if (filters.tags.length) params.set('tags', filters.tags.join(','));
  if (filters.company) params.set('company', filters.company);
  if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
  if (filters.dateTo) params.set('dateTo', filters.dateTo);
  if (filters.archived) params.set('archived', 'true');
  if (filters.sort !== DEFAULT_SORT) params.set('sort', filters.sort);
  if (filters.page !== 1) params.set('page', String(filters.page));
  if (filters.limit !== DEFAULT_LIMIT) params.set('limit', String(filters.limit));

  return params;
}

/** The same shape as the URL, handed to axios as request params. */
export function toQueryParams(filters: ApplicationFilters): Record<string, string> {
  return Object.fromEntries(toSearchParams(filters));
}

/** True when anything narrows the list, which drives the empty state's "Clear filters". */
export function hasActiveFilters(filters: ApplicationFilters): boolean {
  return (
    filters.search !== '' ||
    filters.company !== '' ||
    filters.archived ||
    filters.dateFrom !== undefined ||
    filters.dateTo !== undefined ||
    filters.status.length > 0 ||
    filters.source.length > 0 ||
    filters.workMode.length > 0 ||
    filters.priority.length > 0 ||
    filters.tags.length > 0
  );
}

/**
 * True when anything other than search text narrows the list, which drives the
 * toolbar's "Clear filters". Search text has its own clear button in the field,
 * and counting it made the toolbar re-flow about 300 ms into typing.
 */
export function hasFiltersBeyondSearch(filters: ApplicationFilters): boolean {
  return hasActiveFilters({ ...filters, search: '' });
}
