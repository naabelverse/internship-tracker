import mongoose, { type FilterQuery, type Types } from 'mongoose';
import {
  Application,
  type ApplicationDocument,
  type ApplicationAttributes,
  type ApplicationStatus,
} from '@/models/Application';
import type {
  BulkActionInput,
  CreateApplicationInput,
  ListApplicationsQuery,
  StatusChangeInput,
  UpdateApplicationInput,
} from '@/schemas/application.schema';
import { ApiError } from '@/utils/ApiError';
import { buildPaginationMeta, toSkip, type PageRequest } from '@/utils/pagination';
import { containsRegex, exactRegex } from '@/utils/regex';
import type { PaginationMeta } from '@/utils/apiResponse';

/**
 * Builds a Clearbit style logo URL from the company domain. No network call is
 * made: the client renders an initials avatar when the image fails to load.
 */
export function deriveCompanyLogoUrl(website: string | undefined): string | undefined {
  if (!website) return undefined;

  try {
    const { hostname } = new URL(website);
    return `https://logo.clearbit.com/${hostname.replace(/^www\./, '')}`;
  } catch {
    return undefined;
  }
}

/** The soonest thing the user has to act on: an upcoming deadline or interview. */
export function computeNextActionDate(application: ApplicationDocument): Date | undefined {
  const now = Date.now();
  const candidates: Date[] = [];

  if (application.deadline && application.deadline.getTime() >= now) {
    candidates.push(application.deadline);
  }

  for (const interview of application.interviews) {
    if (interview.outcome === 'pending' && interview.scheduledAt.getTime() >= now) {
      candidates.push(interview.scheduledAt);
    }
  }

  if (candidates.length === 0) return undefined;

  return candidates.reduce((earliest, candidate) => (candidate < earliest ? candidate : earliest));
}

/**
 * The single place a status transition is recorded. Every write path routes
 * through here, which is why there is no pre-save hook: a hook cannot see the
 * note, and two mechanisms would append two entries for one change.
 */
export function applyStatusChange(
  application: ApplicationDocument,
  next: ApplicationStatus,
  note?: string,
): boolean {
  if (application.status === next) return false;

  application.statusHistory.push({
    from: application.status,
    to: next,
    changedAt: new Date(),
    note,
  });
  application.status = next;

  return true;
}

/**
 * Which of the two guards rejected the write. `stale_read` means the client sent
 * a version that was already superseded; `concurrent_write` means it read a
 * current version but lost the race to another writer between load and save.
 */
export type ConflictSource = 'stale_read' | 'concurrent_write';

function versionConflict(current: ApplicationDocument | null, source: ConflictSource): ApiError {
  return ApiError.conflict(
    'This application was changed somewhere else. Reload to see the latest version.',
    'VERSION_CONFLICT',
    { current: current ? current.toJSON() : null, conflictSource: source },
  );
}

/** Rejects a write built on a document the client has already fallen behind on. */
async function assertVersion(
  userId: Types.ObjectId,
  application: ApplicationDocument,
  expected: number | undefined,
): Promise<void> {
  if (expected === undefined) return;
  if (application.__v === expected) return;

  throw versionConflict(
    await Application.findOne({ _id: application._id, user: userId }),
    'stale_read',
  );
}

/**
 * Saves, translating the Mongoose optimistic lock failure into the same 409 the
 * staleness check produces. This is the branch that catches a true race, where
 * both writers read the same version and both passed `assertVersion`.
 */
async function saveWithVersionCheck(
  userId: Types.ObjectId,
  application: ApplicationDocument,
): Promise<ApplicationDocument> {
  try {
    await application.save();
    return application;
  } catch (error) {
    if (error instanceof mongoose.Error.VersionError) {
      throw versionConflict(
        await Application.findOne({ _id: application._id, user: userId }),
        'concurrent_write',
      );
    }
    throw error;
  }
}

/** Every read and write goes through here, so ownership can never be forgotten. */
async function loadOwned(userId: Types.ObjectId, id: string): Promise<ApplicationDocument> {
  const application = await Application.findOne({ _id: id, user: userId });

  if (!application) {
    // 404 rather than 403: a different status would confirm the row exists.
    throw ApiError.notFound('Application not found', 'APPLICATION_NOT_FOUND');
  }

  return application;
}

function buildFilter(
  userId: Types.ObjectId,
  query: ListApplicationsQuery,
): FilterQuery<ApplicationAttributes> {
  const filter: FilterQuery<ApplicationAttributes> = { user: userId };

  if (query.search) {
    const pattern = containsRegex(query.search);
    filter.$or = [{ company: pattern }, { role: pattern }, { tags: pattern }, { notes: pattern }];
  }

  if (query.status?.length) filter.status = { $in: query.status };
  if (query.source?.length) filter.source = { $in: query.source };
  if (query.workMode?.length) filter.workMode = { $in: query.workMode };
  if (query.priority?.length) filter.priority = { $in: query.priority };
  if (query.tags?.length) filter.tags = { $in: query.tags };
  if (query.company) filter.company = exactRegex(query.company);

  if (query.dateFrom || query.dateTo) {
    const range: Record<string, Date> = {};
    if (query.dateFrom) range.$gte = query.dateFrom;
    if (query.dateTo) range.$lte = query.dateTo;
    filter.createdAt = range;
  }

  // Archived rows are hidden unless asked for, which is what the board and table
  // both want by default.
  filter.archived = query.archived ?? false;

  return filter;
}

export interface ApplicationListResult {
  items: ApplicationDocument[];
  meta: PaginationMeta;
}

export async function listApplications(
  userId: Types.ObjectId,
  query: ListApplicationsQuery,
): Promise<ApplicationListResult> {
  const filter = buildFilter(userId, query);
  const page: PageRequest = { page: query.page, limit: query.limit };

  // `_id` breaks ties so paging cannot show the same row twice.
  const sort: Record<string, 1 | -1> = {
    [query.sort.field]: query.sort.direction === 'asc' ? 1 : -1,
    _id: 1,
  };

  const [items, total] = await Promise.all([
    Application.find(filter).sort(sort).skip(toSkip(page)).limit(query.limit),
    Application.countDocuments(filter),
  ]);

  return { items, meta: buildPaginationMeta(total, page) };
}

export async function createApplication(
  userId: Types.ObjectId,
  input: CreateApplicationInput,
): Promise<ApplicationDocument> {
  const status: ApplicationStatus = input.status ?? 'saved';

  const application = new Application({
    ...input,
    user: userId,
    status,
    companyLogoUrl: deriveCompanyLogoUrl(input.companyWebsite),
    // The opening entry, so the detail page timeline has a starting point.
    statusHistory: [{ from: null, to: status, changedAt: new Date() }],
  });

  application.set('nextActionDate', computeNextActionDate(application));
  await application.save();

  return application;
}

export async function getApplication(
  userId: Types.ObjectId,
  id: string,
): Promise<ApplicationDocument> {
  return loadOwned(userId, id);
}

export async function updateApplication(
  userId: Types.ObjectId,
  id: string,
  input: UpdateApplicationInput,
): Promise<ApplicationDocument> {
  const { version, status, ...fields } = input;
  const application = await loadOwned(userId, id);

  await assertVersion(userId, application, version);

  application.set(fields);

  if (status !== undefined) applyStatusChange(application, status);

  if ('companyWebsite' in fields) {
    application.set('companyLogoUrl', deriveCompanyLogoUrl(fields.companyWebsite));
  }

  application.set('nextActionDate', computeNextActionDate(application));

  return saveWithVersionCheck(userId, application);
}

export async function deleteApplication(userId: Types.ObjectId, id: string): Promise<void> {
  const result = await Application.deleteOne({ _id: id, user: userId });

  if (result.deletedCount === 0) {
    throw ApiError.notFound('Application not found', 'APPLICATION_NOT_FOUND');
  }
}

export async function changeStatus(
  userId: Types.ObjectId,
  id: string,
  input: StatusChangeInput,
): Promise<ApplicationDocument> {
  const application = await loadOwned(userId, id);

  applyStatusChange(application, input.status, input.note);
  application.set('nextActionDate', computeNextActionDate(application));

  return saveWithVersionCheck(userId, application);
}

export interface BulkActionResult {
  matched: number;
  modified: number;
  /** Ids that are not live rows for this user, whether missing or owned by someone else. */
  notFound: string[];
}

/**
 * Applies one action to many rows. Ownership is enforced by re-querying every id
 * scoped to the caller, so an id belonging to another account simply never
 * matches and is reported back as not found, exactly like a deleted row.
 */
export async function bulkAction(
  userId: Types.ObjectId,
  input: BulkActionInput,
): Promise<BulkActionResult> {
  const owned = await Application.find({ _id: { $in: input.ids }, user: userId }).select('_id');
  const ownedIds = owned.map((document) => document._id);
  const ownedIdStrings = new Set(ownedIds.map((value) => value.toString()));
  const notFound = input.ids.filter((id) => !ownedIdStrings.has(id));

  if (ownedIds.length === 0) {
    return { matched: 0, modified: 0, notFound };
  }

  const scope = { _id: { $in: ownedIds }, user: userId };

  if (input.action === 'delete') {
    const result = await Application.deleteMany(scope);
    return { matched: ownedIds.length, modified: result.deletedCount, notFound };
  }

  if (input.action === 'archive' || input.action === 'unarchive') {
    const result = await Application.updateMany(scope, {
      $set: { archived: input.action === 'archive' },
    });
    return { matched: ownedIds.length, modified: result.modifiedCount, notFound };
  }

  // setStatus has to go document by document: every transition owes an entry in
  // statusHistory, which a single updateMany cannot produce.
  const status = input.payload?.status;

  if (!status) {
    throw ApiError.badRequest('payload.status is required for setStatus', 'VALIDATION_ERROR');
  }

  const documents = await Application.find(scope);
  let modified = 0;

  for (const application of documents) {
    if (!applyStatusChange(application, status)) continue;

    application.set('nextActionDate', computeNextActionDate(application));
    await application.save();
    modified += 1;
  }

  return { matched: ownedIds.length, modified, notFound };
}
